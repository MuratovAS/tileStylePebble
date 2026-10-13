#include "render.h"
#include "fonts.h"
#include "util.h"

const int TEXT_SIZES[TEXT_SIZE_COUNT] = {14, 18, 24, 28, 30, 42};

// --- text --------------------------------------------------------------------

static const char *const FONT_KEYS[SYSFONT_COUNT] = {
  FONT_KEY_GOTHIC_14, FONT_KEY_GOTHIC_14_BOLD, FONT_KEY_GOTHIC_18, FONT_KEY_GOTHIC_18_BOLD,
  FONT_KEY_GOTHIC_24, FONT_KEY_GOTHIC_24_BOLD, FONT_KEY_GOTHIC_28, FONT_KEY_GOTHIC_28_BOLD,
  FONT_KEY_BITHAM_30_BLACK, FONT_KEY_BITHAM_42_BOLD,
};

// Where graphics_draw_text puts a glyph relative to the text box origin,
// compared to the .pbf glyph offsets the preview uses (calibrated in the
// emulator): box = (line left + TEXT_DX, line top + TEXT_DY)
static const int8_t TEXT_DX[SYSFONT_COUNT] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
static const int8_t TEXT_DY[SYSFONT_COUNT] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0};

static GFont s_fonts[SYSFONT_COUNT];

static SysFont font_for(int size, bool bold) {
  switch (size) {
    case 18: return bold ? SYSFONT_GOTHIC_18_BOLD : SYSFONT_GOTHIC_18;
    case 24: return bold ? SYSFONT_GOTHIC_24_BOLD : SYSFONT_GOTHIC_24;
    case 28: return bold ? SYSFONT_GOTHIC_28_BOLD : SYSFONT_GOTHIC_28;
    case 30: return SYSFONT_BITHAM_30_BLACK;
    case 42: return SYSFONT_BITHAM_42_BOLD;
    default: return bold ? SYSFONT_GOTHIC_14_BOLD : SYSFONT_GOTHIC_14;
  }
}

// Whether the font has a glyph for cp (the preview's covers())
static bool has_glyph(SysFont f, uint32_t cp) {
  if (cp == GLYPH_WILDCARD_CP) return true;
  return cp >= GLYPH_FIRST && cp <= GLYPH_LAST && g_glyph_metrics[f][cp - GLYPH_FIRST].h != GLYPH_MISSING;
}

// Glyph metrics; missing characters are drawn as the wildcard glyph
static const GlyphMetric *glyph(SysFont f, uint32_t cp) {
  return has_glyph(f, cp) && cp != GLYPH_WILDCARD_CP ? &g_glyph_metrics[f][cp - GLYPH_FIRST] : &g_glyph_wildcard[f];
}

static bool covers(SysFont f, const char *s) {
  while (*s) {
    if (!has_glyph(f, utf8_next(&s))) return false;
  }
  return true;
}

static int measure_font(const char *s, SysFont f) {
  int w = 0;
  while (*s) w += glyph(f, utf8_next(&s))->adv;
  return w;
}

static void ink_font(const char *s, SysFont f, int *top, int *h) {
  int t = 1000, b = -1000;
  while (*s) {
    const GlyphMetric *m = glyph(f, utf8_next(&s));
    if (!m->h) continue;
    t = MIN(t, m->top);
    b = MAX(b, m->top + m->h);
  }
  if (t == 1000) {
    *top = 0;
    *h = 0;
  } else {
    *top = t;
    *h = b - t;
  }
}

int text_measure(const char *s, int size, bool bold) {
  return measure_font(s, font_for(size, bold));
}

void text_ink(const char *s, int size, bool bold, int *top, int *h) {
  ink_font(s, font_for(size, bold), top, h);
}

int text_ink_height(const char *s, int size, bool bold) {
  int top, h;
  text_ink(s, size, bold, &top, &h);
  return h;
}

int text_fit(const char *s, double max_w, double max_h, bool bold) {
  if (!s || !*s) s = "X";
  int best = TEXT_SIZES[0];
  for (int i = 0; i < TEXT_SIZE_COUNT; i++) {
    int size = TEXT_SIZES[i];
    SysFont f = font_for(size, bold);
    // Bitham has no regular face; regular text stays in Gothic
    if (!bold && f == font_for(size, true)) continue;
    if (!covers(f, s)) continue;
    int top, h;
    ink_font(s, f, &top, &h);
    if (h <= max_h && measure_font(s, f) <= max_w) best = size;
  }
  return best;
}

int text_snap(double px) {
  int best = TEXT_SIZES[0];
  for (int i = 0; i < TEXT_SIZE_COUNT; i++) {
    if (TEXT_SIZES[i] <= px) best = TEXT_SIZES[i];
  }
  return best;
}

int g_ax(const G *g, double cw) {
  const int pad = 4;
  if (g->align == ALIGN_LEFT) return pad;
  if (g->align == ALIGN_RIGHT) return js_floor(g->w - pad - cw);
  return js_floor((g->w - cw) / 2);
}

void g_text(const G *g, const char *s, double x, double y, int size, GColor color, bool bold, uint8_t align) {
  SysFont f = font_for(size, bold);
  int w = measure_font(s, f);
  double lx = align == ALIGN_LEFT ? x : align == ALIGN_RIGHT ? x - w : x - w / 2.0;
  int cx = js_round(lx);
  int top, h;
  ink_font(s, f, &top, &h);
  int line_top = js_round(y) - top;

  // characters the preview has no glyph for are drawn as the wildcard, as there
  char buf[128];
  int n = 0;
  const char *p = s;
  while (*p && n < (int)sizeof(buf) - 5) {
    uint32_t cp = utf8_next(&p);
    n += utf8_put(buf + n, has_glyph(f, cp) ? cp : GLYPH_WILDCARD_CP);
  }
  buf[n] = 0;

  if (!s_fonts[f]) s_fonts[f] = fonts_get_system_font(FONT_KEYS[f]);
  graphics_context_set_text_color(g->ctx, color);
  graphics_draw_text(g->ctx, buf, s_fonts[f], GRect(cx + TEXT_DX[f], line_top + TEXT_DY[f], w + 64, size * 2 + 16),
                     GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

// --- icons -------------------------------------------------------------------

int g_icon_size(double budget) {
  int best = ICON_SIZE_LIST[0];
  for (int i = 0; i < ICON_SIZE_COUNT; i++) {
    if (ICON_SIZE_LIST[i] <= budget) best = ICON_SIZE_LIST[i];
  }
  return best;
}

void g_icon(const G *g, IconId icon, double x, double y, int size, GColor stroke, GColor fill) {
  if (gcolor_equal(fill, GColorClear)) fill = g->icon_fill;
  icons_draw(g->ctx, icon, size, js_round(x), js_round(y), stroke, fill);
}

// Battery body is an icon; the level is a rectangle inside it
// (in TimeStyle at 25 px: x 3, y 8, width up to 18, height 8; other sizes
// come from the frame bitmaps, BATTERY_LEVEL_BOXES). While charging,
// TimeStyle's bolt replaces the level.
static const int8_t BATTERY_LEVEL[ICON_SIZE_COUNT][4] = BATTERY_LEVEL_BOXES;

void g_battery(const G *g, double x, double y, int size, GColor color, int level, bool charging) {
  g_icon(g, ICON_BATTERY_FRAME, x, y, size, color, GColorClear);
  if (charging) {
    g_icon(g, ICON_BATTERY_CHARGE, x, y, size, color, GColorClear);
    return;
  }
  int i = 0;
  while (i < ICON_SIZE_COUNT - 1 && ICON_SIZE_LIST[i] != size) i++;
  const int8_t *b = BATTERY_LEVEL[i];
  int fw = MAX(1, js_round((double)b[2] * level / 100));
  graphics_context_set_fill_color(g->ctx, color);
  graphics_fill_rect(g->ctx, GRect(js_round(x) + b[0], js_round(y) + b[1], fw, b[3]), 0, GCornerNone);
}

// --- shapes ------------------------------------------------------------------

static void fill_span(GContext *ctx, int x, int y, int w, int h) {
  if (w > 0 && h > 0) graphics_fill_rect(ctx, GRect(x, y, w, h), 0, GCornerNone);
}

void g_rect(const G *g, double x, double y, double w, double h, GColor color) {
  graphics_context_set_fill_color(g->ctx, color);
  fill_span(g->ctx, js_round(x), js_round(y), js_round(w), js_round(h));
}

// Non-antialiased line (Bresenham); width is a square brush
void g_line(const G *g, int x0, int y0, int x1, int y1, GColor color, int width) {
  int wd = width > 0 ? width : 1, off = (wd - 1) / 2;
  int dx = abs(x1 - x0), dy = -abs(y1 - y0);
  int sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  graphics_context_set_fill_color(g->ctx, color);
  for (;;) {
    fill_span(g->ctx, x0 - off, y0 - off, wd, wd);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// Inset of row j from the edge of a rectangle with corner radius r
static int corner_inset(int j, int h, int r) {
  double d = j < r ? r - j - 0.5 : (j >= h - r ? j - (h - r) + 0.5 : -1);
  if (d < 0) return 0;
  double q = (double)r * r - d * d;
  return js_round(r - js_sqrt(q > 0 ? q : 0));
}

void fill_round_rect(GContext *ctx, int x, int y, int w, int h, int r, GColor color) {
  r = MAX(0, MIN(r, MIN(w / 2, h / 2)));
  graphics_context_set_fill_color(ctx, color);
  if (!r) {
    fill_span(ctx, x, y, w, h);
    return;
  }
  for (int j = 0; j < h; j++) {
    int ins = corner_inset(j, h, r);
    fill_span(ctx, x + ins, y + j, w - ins * 2, 1);
  }
}

// fill (unless GColorClear) paints the inside of the frame
static void stroke_round_rect(GContext *ctx, int x, int y, int w, int h, int r, int lw, GColor color, GColor fill) {
  bool filled = !gcolor_equal(fill, GColorClear);
  graphics_context_set_fill_color(ctx, color);
  int ri = MAX(0, r - lw);
  for (int j = 0; j < h; j++) {
    int o = corner_inset(j, h, r);
    int jj = j - lw;
    if (jj < 0 || jj >= h - lw * 2) {
      fill_span(ctx, x + o, y + j, w - o * 2, 1);
      continue;
    }
    int i = lw + corner_inset(jj, h - lw * 2, ri);
    fill_span(ctx, x + o, y + j, i - o, 1);
    fill_span(ctx, x + w - i, y + j, i - o, 1);
    if (filled) {
      graphics_context_set_fill_color(ctx, fill);
      fill_span(ctx, x + i, y + j, w - i * 2, 1);
      graphics_context_set_fill_color(ctx, color);
    }
  }
}

void g_frame(const G *g, double x, double y, double w, double h, GColor color, int lw, int r, GColor fill) {
  stroke_round_rect(g->ctx, js_round(x), js_round(y), js_round(w), js_round(h), r, lw, color, fill);
}

// --- clock -------------------------------------------------------------------

static FFont *s_clock_fonts[CLOCK_FONT_COUNT];
static const uint32_t CLOCK_RESOURCES[CLOCK_FONT_COUNT] = {
  RESOURCE_ID_AVENIR_REGULAR_FFONT, RESOURCE_ID_AVENIR_BOLD_FFONT, RESOURCE_ID_LECO_REGULAR_FFONT,
};

static int clock_glyph_index(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c == ':') return 10;
  return -1;
}

ClockInk clock_ink(const char *s, ClockFont font) {
  const ClockFontInfo *f = &g_clock_fonts[font];
  double pen = 0, x0 = 1e9, x1 = -1e9, top = -1e9, bottom = 1e9;
  for (; *s; s++) {
    int i = clock_glyph_index(*s);
    if (i < 0) continue;
    const ClockGlyph *gl = &f->glyphs[i];
    x0 = MIN(x0, pen + gl->x0 / 4.0);
    x1 = MAX(x1, pen + gl->x1 / 4.0);
    top = MAX(top, gl->top / 4.0);
    bottom = MIN(bottom, gl->bottom / 4.0);
    pen += gl->adv16 / 16.0;
  }
  if (x0 == 1e9) return (ClockInk){0, 0, 0, 0};
  double upem = f->upem16 / 16.0;
  return (ClockInk){x0 / upem, top / upem, (x1 - x0) / upem, (top - bottom) / upem};
}

static int32_t to_fixed(double v) {
  return js_round(v * FIXED_POINT_SCALE);
}

// Outline walker: fctx flattens curves into a few chords, which loses pixels
// along the round digits compared to the preview's exact outline, so curves
// are flattened here finely and passed to fctx as line segments.
typedef struct {
  FContext *fctx;
  double ox, oy, scale;   // screen position of the glyph origin, px per 1/16 font unit
  double x, y;            // current point, font units x16
  double sx, sy;          // subpath start
  double cx, cy;          // last control point (for S and T)
  bool open;
} Walker;

static FPoint walker_point(const Walker *w, double x, double y) {
  return FPoint(to_fixed(w->ox + x * w->scale), to_fixed(w->oy - y * w->scale));
}

static void walker_line(Walker *w, double x, double y) {
  fctx_line_to(w->fctx, walker_point(w, x, y));
  w->x = x;
  w->y = y;
}

static int curve_steps(const Walker *w, double len) {
  int n = js_ceil(len * w->scale / 1.5);
  return CLAMP(n, 2, 48);
}

static void walker_cubic(Walker *w, double x1, double y1, double x2, double y2, double x, double y) {
  double x0 = w->x, y0 = w->y;
  double len = js_sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) +
               js_sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) +
               js_sqrt((x - x2) * (x - x2) + (y - y2) * (y - y2));
  int n = curve_steps(w, len);
  for (int i = 1; i <= n; i++) {
    double t = (double)i / n, u = 1 - t;
    double a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    fctx_line_to(w->fctx, walker_point(w, a * x0 + b * x1 + c * x2 + d * x, a * y0 + b * y1 + c * y2 + d * y));
  }
  w->x = x;
  w->y = y;
  w->cx = x2;
  w->cy = y2;
}

static void walker_quad(Walker *w, double x1, double y1, double x, double y) {
  double x0 = w->x, y0 = w->y;
  double len = js_sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) +
               js_sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));
  int n = curve_steps(w, len);
  for (int i = 1; i <= n; i++) {
    double t = (double)i / n, u = 1 - t;
    double a = u * u, b = 2 * u * t, c = t * t;
    fctx_line_to(w->fctx, walker_point(w, a * x0 + b * x1 + c * x, a * y0 + b * y1 + c * y));
  }
  w->x = x;
  w->y = y;
  w->cx = x1;
  w->cy = y1;
}

static void walker_close(Walker *w) {
  if (!w->open) return;
  if (w->x != w->sx || w->y != w->sy) walker_line(w, w->sx, w->sy);
  fctx_close_path(w->fctx);
  w->open = false;
}

static int16_t rd_i16(const uint8_t *p) {
  return (int16_t)(p[0] | (p[1] << 8));
}

// Path data of a .ffont glyph: uint16 command letter, then int16 params
// (absolute coordinates in 1/16 font units, y up)
static void walk_glyph(Walker *w, const uint8_t *d, int len) {
  int p = 0;
  char prev = 0;
  while (p + 2 <= len) {
    char cmd = (char)rd_i16(d + p);
    p += 2;
    int np = 0;
    switch (cmd) {
      case 'M': case 'L': case 'T': np = 2; break;
      case 'H': case 'V': np = 1; break;
      case 'C': np = 6; break;
      case 'S': case 'Q': np = 4; break;
      case 'Z': np = 0; break;
      default: return;
    }
    if (p + np * 2 > len) return;
    double v[6];
    for (int i = 0; i < np; i++) v[i] = rd_i16(d + p + i * 2);
    p += np * 2;
    bool prev_cubic = prev == 'C' || prev == 'S', prev_quad = prev == 'Q' || prev == 'T';
    switch (cmd) {
      case 'M':
        walker_close(w);
        fctx_move_to(w->fctx, walker_point(w, v[0], v[1]));
        w->x = w->sx = v[0];
        w->y = w->sy = v[1];
        w->open = true;
        break;
      case 'L': walker_line(w, v[0], v[1]); break;
      case 'H': walker_line(w, v[0], w->y); break;
      case 'V': walker_line(w, w->x, v[0]); break;
      case 'C': walker_cubic(w, v[0], v[1], v[2], v[3], v[4], v[5]); break;
      case 'S': {
        double x1 = prev_cubic ? 2 * w->x - w->cx : w->x, y1 = prev_cubic ? 2 * w->y - w->cy : w->y;
        walker_cubic(w, x1, y1, v[0], v[1], v[2], v[3]);
        break;
      }
      case 'Q': walker_quad(w, v[0], v[1], v[2], v[3]); break;
      case 'T': {
        double x1 = prev_quad ? 2 * w->x - w->cx : w->x, y1 = prev_quad ? 2 * w->y - w->cy : w->y;
        walker_quad(w, x1, y1, v[0], v[1]);
        break;
      }
      case 'Z': walker_close(w); break;
    }
    prev = cmd;
  }
  walker_close(w);
}

// Heap left untouched when choosing between AA and BW clock rendering
#define CLOCK_HEAP_MARGIN 4096

// fctx's own AA init allocates an 8-bit flag buffer as large as the whole
// framebuffer (45.6 KB on emery) and does not check the result. fctx indexes
// that buffer in screen coordinates, so it only has to reach the block's
// right and bottom edges: this sets the context up like
// fctx_init_context_aa() does, with such a smaller buffer, and fails cleanly
// when there is no memory for it.
static bool init_aa_context(FContext *f, GContext *ctx, GRect block) {
  GSize size = GSize(MIN(block.origin.x + block.size.w, SCREEN_W), MIN(block.origin.y + block.size.h, SCREEN_H));
  if (size.w <= 0 || size.h <= 0) return false;
  if ((int)heap_bytes_free() < size.w * size.h + CLOCK_HEAP_MARGIN) return false;
  GBitmap *buf = gbitmap_create_blank(size, GBitmapFormat8Bit);
  if (!buf) return false;
  memset(f, 0, sizeof(*f));
  f->gctx = ctx;
  f->flag_buffer = buf;
  f->flag_bounds = GRect(0, 0, size.w, size.h);
  f->transform_scale_from = FPoint(1, 1);
  f->transform_scale_to = FPoint(1, 1);
  f->subpixel_adjust = -1;
  f->fill_color = GColorWhite;
  f->color_bias = 0;
  return true;
}

// BW flag buffer: 1 bit per screen pixel, allocated by fctx
#define BW_BUFFER_BYTES (SCREEN_W * SCREEN_H / 8 + 64)

bool clock_begin(ClockPainter *p, const G *g, ClockFont font, GColor color, bool aa) {
  memset(p, 0, sizeof(*p));
  if (!s_clock_fonts[font]) s_clock_fonts[font] = ffont_create_from_resource(CLOCK_RESOURCES[font]);
  p->ff = s_clock_fonts[font];
  p->font = font;
  if (!p->ff) return false;
  bool ok = false;
  if (aa) {
    fctx_enable_aa(true);
    ok = init_aa_context(&p->fctx, g->ctx, GRect(g->origin.x, g->origin.y, g->w, g->h));
  }
  if (!ok) {
    // without AA (or when memory is short for it)
    if ((int)heap_bytes_free() < BW_BUFFER_BYTES + CLOCK_HEAP_MARGIN) return false;
    fctx_enable_aa(false);
    fctx_init_context(&p->fctx, g->ctx);
    if (!p->fctx.flag_buffer) return false;
  }
  fctx_set_fill_color(&p->fctx, color);
  fctx_set_color_bias(&p->fctx, 0);
  fctx_begin_fill(&p->fctx);
  p->ok = true;
  return true;
}

void clock_line(ClockPainter *p, const G *g, const char *s, int em, double left, double top, int hide) {
  if (!p->ok || em <= 0) return;
  ClockFont font = p->font;
  left = js_round(left);
  top = js_round(top);
  ClockInk ink = clock_ink(s, font);
  // pen and baseline of the first glyph, in screen pixels
  double pen = g->origin.x + left - ink.x0 * em;
  double baseline = g->origin.y + top + ink.top * em;
  double scale = (double)em / g_clock_fonts[font].upem16;  // px per 1/16 font unit

  Walker w = {.fctx = &p->fctx, .oy = baseline, .scale = scale};
  int adv = 0;
  int idx = 0;
  for (const char *c = s; *c; c++, idx++) {
    FGlyph *gl = ffont_glyph_info(p->ff, (uint8_t)*c);
    if (!gl) continue;
    if (idx >= hide) {
      w.ox = pen + adv * scale;
      walk_glyph(&w, ffont_glyph_outline(p->ff, gl), gl->path_data_length);
    }
    adv += gl->horiz_adv_x;
  }
}

void clock_end(ClockPainter *p) {
  if (!p->ok) return;
  fctx_end_fill(&p->fctx);
  fctx_deinit_context(&p->fctx);
  p->ok = false;
}

void render_free_fonts(void) {
  for (int i = 0; i < CLOCK_FONT_COUNT; i++) {
    if (s_clock_fonts[i]) ffont_destroy(s_clock_fonts[i]);
    s_clock_fonts[i] = NULL;
  }
}
