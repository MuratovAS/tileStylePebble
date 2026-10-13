/*
 * TileStyle: blocks tiling the screen, each showing a widget. The drawing logic
 * mirrors the settings page preview (config/js/raster.js, widgets.js).
 */
#include <pebble.h>
#include "data.h"
#include "icons.h"
#include "messaging.h"
#include "render.h"
#include "settings.h"
#include "widgets.h"

static Window *s_window;
static Layer *s_blocks[CONFIG_MAX_BLOCKS];
static Layer *s_lines;
static int s_block_count;
static int s_last_hour = -1;

static GColor color8(uint8_t argb) {
  return (GColor){.argb = argb};
}

typedef struct {
  int index;
} BlockLayerData;

// Raster.blockColors
static void block_colors(const BlockConfig *b, GColor *bg, GColor *fg, GColor *accent, GColor *icon_fill) {
  const Settings *s = &g_settings;
  uint8_t c = b->bg ? b->bg : (s->tile ? s->tile : s->bg);
  *bg = color8(c);
  *fg = color8(b->fg ? b->fg : s->fg);
  *accent = color8(b->accent ? b->accent : s->accent);
  *icon_fill = color8(b->icon_fill ? b->icon_fill : (s->icon_fill ? s->icon_fill : c));
}

// --- clock cache ---------------------------------------------------------------
//
// The system redraws every layer whenever any layer is dirty, so with a
// seconds widget the clock would be rasterized every second. Instead, the
// finished pixels of a time block are copied from the framebuffer once per
// minute and blitted on the other frames.

static GBitmap *s_clock_cache[CONFIG_MAX_BLOCKS];
static int32_t s_clock_cache_minute[CONFIG_MAX_BLOCKS];
static bool s_cache_clock;  // a seconds widget is shown

static void clock_cache_free(int i) {
  if (s_clock_cache[i]) gbitmap_destroy(s_clock_cache[i]);
  s_clock_cache[i] = NULL;
}

static void clock_cache_flush(void) {
  for (int i = 0; i < CONFIG_MAX_BLOCKS; i++) clock_cache_free(i);
}

static void clock_cache_store(int i, GContext *ctx, GRect r, int32_t minute) {
  if ((int)heap_bytes_free() < r.size.w * r.size.h + 8192) return;
  GBitmap *bmp = gbitmap_create_blank(r.size, GBitmapFormat8Bit);
  if (!bmp) return;
  GBitmap *fb = graphics_capture_frame_buffer(ctx);
  if (!fb) {
    gbitmap_destroy(bmp);
    return;
  }
  uint8_t *dst = gbitmap_get_data(bmp);
  int stride = gbitmap_get_bytes_per_row(bmp);
  for (int y = 0; y < r.size.h; y++) {
    GBitmapDataRowInfo row = gbitmap_get_data_row_info(fb, r.origin.y + y);
    int x0 = r.origin.x, x1 = r.origin.x + r.size.w - 1;
    if (x0 < row.min_x || x1 > row.max_x) {
      // not a plain rectangular framebuffer: do not cache
      graphics_release_frame_buffer(ctx, fb);
      gbitmap_destroy(bmp);
      return;
    }
    memcpy(dst + y * stride, row.data + x0, r.size.w);
  }
  graphics_release_frame_buffer(ctx, fb);
  s_clock_cache[i] = bmp;
  s_clock_cache_minute[i] = minute;
}

static void block_update(Layer *layer, GContext *ctx) {
  BlockLayerData *d = layer_get_data(layer);
  if (d->index >= g_settings.count) return;
  const BlockConfig *b = &g_settings.blocks[d->index];
  GRect r = layer_get_frame(layer);
  if (r.size.w <= 0 || r.size.h <= 0) return;
  graphics_context_set_antialiased(ctx, false);

  time_t now = data_now();
  int32_t minute = (int32_t)(now / 60);
  bool cache = s_cache_clock && b->widget == WIDGET_TIME;
  if (cache) {
    if (s_clock_cache[d->index] && s_clock_cache_minute[d->index] == minute) {
      graphics_context_set_compositing_mode(ctx, GCompOpAssign);
      graphics_draw_bitmap_in_rect(ctx, s_clock_cache[d->index], GRect(0, 0, r.size.w, r.size.h));
      return;
    }
    // free the old copy first: the clock may need memory for antialiasing
    clock_cache_free(d->index);
  }

  Box box;
  memset(&box, 0, sizeof(box));
  GColor icon_fill;
  block_colors(b, &box.bg, &box.fg, &box.accent, &icon_fill);
  if (box.bg.argb != g_settings.bg) {
    fill_round_rect(ctx, 0, 0, r.size.w, r.size.h, g_settings.radius, box.bg);
  }
  box.g = (G){.ctx = ctx, .w = r.size.w, .h = r.size.h, .icon_fill = icon_fill, .align = b->align,
              .origin = r.origin};
  box.b = b;
  box.t = now;
  box.now = *localtime(&box.t);
  box.metric = g_settings.metric;
  box.clock12 = !g_settings.clock24;
  widget_draw(&box);
  if (cache) clock_cache_store(d->index, ctx, r, minute);
}

static void background_update(Layer *layer, GContext *ctx) {
  graphics_context_set_fill_color(ctx, color8(g_settings.bg));
  graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);
}

// Segment along an axis from `from` to `to` (exclusive) at cross coordinate
// `at`; dashes and dots are counted from the screen origin
static void line_span(GContext *ctx, int from, int to, int at, bool horiz) {
  const Settings *s = &g_settings;
  int lw = s->line_width ? s->line_width : 1;
  int shift = -(lw / 2);
  int on = s->line_style == LINE_DASHED ? 4 * lw : lw;
  int period = s->line_style == LINE_DASHED ? 6 * lw : 2 * lw;
  int p = from;
  while (p < to) {
    int len;
    if (s->line_style == LINE_SOLID) {
      len = to - p;
    } else {
      int phase = p % period;
      if (phase >= on) {
        p += period - phase;
        continue;
      }
      len = on - phase < to - p ? on - phase : to - p;
    }
    if (horiz) graphics_fill_rect(ctx, GRect(p, at + shift, len, lw), 0, GCornerNone);
    else graphics_fill_rect(ctx, GRect(at + shift, p, lw, len), 0, GCornerNone);
    p += len;
  }
}

// Lines along inner block borders (none along the screen edge)
static void lines_update(Layer *layer, GContext *ctx) {
  const Settings *s = &g_settings;
  graphics_context_set_fill_color(ctx, color8(s->line_color ? s->line_color : s->fg));
  for (int i = 0; i < s->count; i++) {
    const BlockConfig *b = &s->blocks[i];
    // every inner border is the right or bottom side of some block
    if (b->x + b->w < SCREEN_W) line_span(ctx, b->y, b->y + b->h, b->x + b->w, false);
    if (b->y + b->h < SCREEN_H) line_span(ctx, b->x, b->x + b->w, b->y + b->h, true);
  }
}

static void redraw(void) {
  if (s_window) layer_mark_dirty(window_get_root_layer(s_window));
}

static void destroy_layers(void) {
  for (int i = 0; i < s_block_count; i++) {
    layer_destroy(s_blocks[i]);
    s_blocks[i] = NULL;
  }
  s_block_count = 0;
  if (s_lines) layer_destroy(s_lines);
  s_lines = NULL;
}

static void tick_handler(struct tm *t, TimeUnits changed);

static void build_layers(void) {
  destroy_layers();
  // bitmaps and fonts of the previous layout are loaded again on demand
  icons_flush();
  render_free_fonts();
  clock_cache_flush();
  s_cache_clock = settings_has_widget(WIDGET_SECONDS);
  Layer *root = window_get_root_layer(s_window);
  for (int i = 0; i < g_settings.count; i++) {
    GRect r = settings_block_rect(&g_settings.blocks[i]);
    Layer *l = layer_create_with_data(r, sizeof(BlockLayerData));
    ((BlockLayerData *)layer_get_data(l))->index = i;
    layer_set_update_proc(l, block_update);
    layer_add_child(root, l);
    s_blocks[i] = l;
  }
  s_block_count = g_settings.count;
  if (g_settings.line_on) {
    s_lines = layer_create(layer_get_bounds(root));
    layer_set_update_proc(s_lines, lines_update);
    layer_add_child(root, s_lines);
  }
  // wake up every second only if a seconds widget is shown
  tick_timer_service_subscribe(s_cache_clock ? SECOND_UNIT : MINUTE_UNIT, tick_handler);
  redraw();
}

static void tick_handler(struct tm *t, TimeUnits changed) {
  if (changed & MINUTE_UNIT) {
    if (t->tm_hour != s_last_hour) {
      s_last_hour = t->tm_hour;
      data_refresh_health();
    }
    messaging_check_weather();
  }
  redraw();
}

static void config_changed(void) {
  build_layers();
  data_refresh_health();
  messaging_check_weather();
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  layer_set_update_proc(root, background_update);
  build_layers();
}

static void window_unload(Window *window) {
  destroy_layers();
}

static void init(void) {
  settings_init();
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){.load = window_load, .unload = window_unload});
  data_init(redraw);
  window_stack_push(s_window, true);
  time_t now = time(NULL);
  s_last_hour = localtime(&now)->tm_hour;
  messaging_init(config_changed);
}

static void deinit(void) {
  messaging_deinit();
  tick_timer_service_unsubscribe();
  data_deinit();
  window_destroy(s_window);
  clock_cache_flush();
  icons_flush();
  render_free_fonts();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
