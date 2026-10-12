#include "settings.h"
#include "util.h"

Settings g_settings;

// Persistent storage: blob length + chunks of up to 256 bytes
#define PERSIST_KEY_CFG_LEN 100
#define PERSIST_KEY_CFG_CHUNK 101  // 101..108
#define PERSIST_CHUNK 256

// Default: the "timestyle" preset of config/js/presets.js with the widget
// option defaults of config/js/widgets.js
static const uint8_t DEFAULT_BLOB[] = {
  1,                       // version
  0x07,                    // clock24, metric, btVibe
  53, 53, 52, 42,          // cols
  57, 57, 57, 57,          // rows
  0xC0, 0x00, 0xFF, 0xF4,  // bg black, tile null, fg white, accent #FF5500
  0xFF,                    // iconFill white
  0, 0,                    // gap, radius
  1, 0xFF, 0,              // lineWidth, lineColor, lineStyle
  30,                      // weatherInterval
  5,                       // blocks
  // time: avenir, stack, zero
  0, 0, 3, 4, WIDGET_TIME, 0, 0, 0, ALIGN_CENTER, 3, 0, 2, 0x01,
  // weather
  3, 0, 1, 1, WIDGET_WEATHER, 0xF4, 0xC0, 0xC0, ALIGN_CENTER, 0,
  // date: calendar, upper, pattern "%a %e %b"
  3, 1, 1, 1, WIDGET_DATE, 0xF4, 0xC0, 0xC0, ALIGN_CENTER, 11, 0, 1, 8, '%', 'a', ' ', '%', 'e', ' ', '%', 'b',
  // steps: goal 0, short
  3, 2, 1, 1, WIDGET_STEPS, 0xF4, 0xC0, 0xC0, ALIGN_CENTER, 3, 0, 0, 1,
  // battery: icon_pct
  3, 3, 1, 1, WIDGET_BATTERY, 0xF4, 0xC0, 0xC0, ALIGN_CENTER, 1, 1,
};

// Option defaults from widgets.js, in protocol byte order
static void set_defaults(BlockConfig *b) {
  memset(b->opt, 0, sizeof(b->opt));
  b->str[0] = 0;
  switch (b->widget) {
    case WIDGET_TIME: b->opt[0] = 0; b->opt[1] = 0; b->opt[2] = 0x01; break;
    case WIDGET_DATE: b->opt[0] = 0; b->opt[1] = 1; strcpy(b->str, "%a %e %b"); break;
    case WIDGET_WEEKDAY: b->opt[0] = 1; break;
    case WIDGET_BATTERY: b->opt[0] = 1; break;
    case WIDGET_BLUETOOTH: b->opt[0] = 1; break;
    case WIDGET_STEPS: b->opt[0] = 10000 & 0xFF; b->opt[1] = 10000 >> 8; b->opt[2] = 1; break;
    case WIDGET_STEPS_GRAPH: b->opt[0] = 6; break;
    case WIDGET_ALT_TZ: b->opt[0] = 0; strcpy(b->str, "UTC"); break;
    case WIDGET_TEXT: strcpy(b->str, "Hello"); break;
    case WIDGET_HOURLY: b->opt[0] = 0; b->opt[1] = 1; b->opt[2] = 0; break;
    case WIDGET_DIVIDER: b->opt[0] = 0; b->opt[1] = 0; b->opt[2] = 1; b->opt[3] = 4; break;
    default: break;
  }
}

// Reads widget options from p[0..len)
static void parse_opts(BlockConfig *b, const uint8_t *p, int len) {
  set_defaults(b);
  int fixed = 0;   // leading fixed-size bytes
  switch (b->widget) {
    case WIDGET_DATE: fixed = 2; break;
    case WIDGET_ALT_TZ: fixed = 1; break;
    case WIDGET_TEXT: fixed = 0; break;
    default:
      memcpy(b->opt, p, MIN(len, BLOCK_OPT_MAX));
      return;
  }
  memcpy(b->opt, p, MIN(len, fixed));
  if (len > fixed) {
    int slen = MIN(p[fixed], len - fixed - 1);
    utf8_copy(b->str, (const char *)p + fixed + 1, slen, BLOCK_STR_MAX);
  }
}

static bool parse(Settings *s, const uint8_t *d, int len) {
  if (len < 22 || d[0] != PROTOCOL_VERSION) return false;
  memset(s, 0, sizeof(*s));
  s->clock24 = d[1] & 1;
  s->metric = (d[1] >> 1) & 1;
  s->bt_vibe = (d[1] >> 2) & 1;
  s->line_on = (d[1] >> 3) & 1;
  int sc = 0, sr = 0;
  for (int i = 0; i < GRID_N; i++) {
    s->cols[i] = d[2 + i];
    s->rows[i] = d[6 + i];
    if (!s->cols[i] || !s->rows[i]) return false;
    sc += s->cols[i];
    sr += s->rows[i];
  }
  if (sc != SCREEN_W || sr != SCREEN_H) return false;
  s->bg = d[10];
  s->tile = d[11];
  s->fg = d[12];
  s->accent = d[13];
  s->icon_fill = d[14];
  s->gap = d[15];
  s->radius = d[16];
  s->line_width = CLAMP(d[17], 1, 8);
  s->line_color = d[18];
  s->line_style = d[19] <= LINE_DOTTED ? d[19] : LINE_SOLID;
  s->weather_interval = d[20];
  s->count = d[21];
  if (!s->bg) s->bg = GColorBlackARGB8;
  if (!s->fg) s->fg = GColorWhiteARGB8;
  if (!s->accent) s->accent = s->fg;
  if (s->count < 1 || s->count > CONFIG_MAX_BLOCKS) return false;

  uint16_t covered = 0;
  int off = 22;
  for (int i = 0; i < s->count; i++) {
    if (off + 10 > len) return false;
    BlockConfig *b = &s->blocks[i];
    const uint8_t *p = d + off;
    b->x = p[0];
    b->y = p[1];
    b->w = p[2];
    b->h = p[3];
    b->widget = p[4] < WIDGET_COUNT ? p[4] : WIDGET_EMPTY;  // unknown ids draw nothing
    b->bg = p[5];
    b->fg = p[6];
    b->accent = p[7];
    b->align = p[8] <= ALIGN_RIGHT ? p[8] : ALIGN_CENTER;
    int ol = p[9];
    off += 10;
    if (off + ol > len) return false;
    parse_opts(b, d + off, ol);
    off += ol;
    if (!b->w || !b->h || b->x + b->w > GRID_N || b->y + b->h > GRID_N) return false;
    // every cell must be covered exactly once
    for (int y = b->y; y < b->y + b->h; y++) {
      for (int x = b->x; x < b->x + b->w; x++) {
        uint16_t bit = 1 << (y * GRID_N + x);
        if (covered & bit) return false;
        covered |= bit;
      }
    }
  }
  return covered == 0xFFFF;
}

// The length is cleared first and written last, only when every chunk was
// stored, so an interrupted or failed write falls back to the default
// instead of loading a mix of old and new chunks
static void persist_blob(const uint8_t *d, int len) {
  persist_write_int(PERSIST_KEY_CFG_LEN, 0);
  int chunks = (len + PERSIST_CHUNK - 1) / PERSIST_CHUNK;
  for (int i = 0; i < chunks; i++) {
    int n = MIN(PERSIST_CHUNK, len - i * PERSIST_CHUNK);
    if (persist_write_data(PERSIST_KEY_CFG_CHUNK + i, d + i * PERSIST_CHUNK, n) != n) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "settings: persisting chunk %d failed", i);
      return;
    }
  }
  persist_write_int(PERSIST_KEY_CFG_LEN, len);
}

bool settings_apply_blob(const uint8_t *data, int len) {
  if (len > SETTINGS_BLOB_MAX) return false;
  Settings *tmp = malloc(sizeof(Settings));
  if (!tmp) return false;
  bool ok = parse(tmp, data, len);
  if (ok) {
    g_settings = *tmp;
    persist_blob(data, len);
  } else {
    APP_LOG(APP_LOG_LEVEL_WARNING, "invalid settings blob (%d bytes)", len);
  }
  free(tmp);
  return ok;
}

void settings_init(void) {
  bool ok = false;
  int len = persist_exists(PERSIST_KEY_CFG_LEN) ? persist_read_int(PERSIST_KEY_CFG_LEN) : 0;
  if (len > 0 && len <= SETTINGS_BLOB_MAX) {
    uint8_t *buf = malloc(len);
    if (buf) {
      int got = 0;
      for (int i = 0; got < len; i++) {
        int n = MIN(PERSIST_CHUNK, len - got);
        if (persist_read_data(PERSIST_KEY_CFG_CHUNK + i, buf + got, n) != n) break;
        got += n;
      }
      if (got == len) ok = parse(&g_settings, buf, len);
      free(buf);
    }
  }
  if (!ok) parse(&g_settings, DEFAULT_BLOB, sizeof(DEFAULT_BLOB));
}

static int track_offset(const uint8_t *tracks, int i) {
  int o = 0;
  for (int k = 0; k < i; k++) o += tracks[k];
  return o;
}

GRect settings_block_rect(const BlockConfig *b) {
  const Settings *s = &g_settings;
  int x0 = track_offset(s->cols, b->x), x1 = track_offset(s->cols, b->x + b->w);
  int y0 = track_offset(s->rows, b->y), y1 = track_offset(s->rows, b->y + b->h);
  // the page only offers even gaps; an odd one is rounded down
  int half = s->gap / 2;
  int l = b->x == 0 ? 0 : half;
  int r = b->x + b->w == GRID_N ? 0 : half;
  int t = b->y == 0 ? 0 : half;
  int bt = b->y + b->h == GRID_N ? 0 : half;
  return GRect(x0 + l, y0 + t, x1 - x0 - l - r, y1 - y0 - t - bt);
}

bool settings_has_widget(WidgetId id) {
  for (int i = 0; i < g_settings.count; i++) {
    if (g_settings.blocks[i].widget == id) return true;
  }
  return false;
}

bool settings_has_weather_widget(void) {
  return settings_has_widget(WIDGET_WEATHER) || settings_has_widget(WIDGET_FORECAST) ||
         settings_has_widget(WIDGET_UV) || settings_has_widget(WIDGET_HOURLY);
}
