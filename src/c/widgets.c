#include "widgets.h"
#include "data.h"
#include "util.h"

// On-watch labels (widgets.js LANG)
static const char *const DAYS[7] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
static const char *const DAYS_LONG[7] = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                                         "Saturday"};
static const char *const MONTHS[12] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                                       "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
static const char *const MONTHS_LONG[12] = {"January", "February", "March", "April", "May", "June", "July",
                                            "August", "September", "October", "November", "December"};

#define DEG "\xC2\xB0"
#define NO_VALUE "--"

// --- formatting ---------------------------------------------------------------

static void pad2(char *out, int n) {
  snprintf(out, 4, "%s%d", n < 10 ? "0" : "", n);
}

// 1234567 -> "1 234 567"
static void fmt_thousands(char *out, int32_t n) {
  char tmp[16];
  snprintf(tmp, sizeof(tmp), "%ld", (long)n);
  int len = strlen(tmp), o = 0;
  for (int i = 0; i < len; i++) {
    out[o++] = tmp[i];
    int left = len - 1 - i;
    if (left > 0 && left % 3 == 0 && tmp[i] != '-') out[o++] = ' ';
  }
  out[o] = 0;
}

// 6342 -> 6.3k, 12480 -> 12.4k, 123456 -> 123k (rounded down)
static void fmt_k(char *out, int32_t n) {
  if (n < 1000) {
    snprintf(out, 16, "%ld", (long)n);
  } else if (n >= 100000) {
    snprintf(out, 16, "%ldk", (long)(n / 1000));
  } else {
    int32_t t = n / 100;
    if (t % 10) snprintf(out, 16, "%ld.%ldk", (long)(t / 10), (long)(t % 10));
    else snprintf(out, 16, "%ldk", (long)(t / 10));
  }
}

// Sign of d * k - c, computed exactly (Veltkamp split): d * k is exact for
// both halves, and rounding a sum never flips its sign
static int exact_cmp(double d, int k, int32_t c) {
  double t = d * 134217729.0;
  double hi = t - (t - d), lo = d - hi;
  double s = (hi * k - (double)c) + lo * k;
  return s > 0 ? 1 : (s < 0 ? -1 : 0);
}

// Number.prototype.toFixed(1) for d >= 0
static void fmt_fixed1(char *out, double d) {
  int32_t n = js_floor(d * 10);
  while (n > 0 && exact_cmp(d, 10, n) < 0) n--;
  while (exact_cmp(d, 10, n + 1) >= 0) n++;
  if (exact_cmp(d, 20, 2 * n + 1) >= 0) n++;
  snprintf(out, 16, "%ld.%ld", (long)(n / 10), (long)(n % 10));
}

static int temp_value(int16_t t10, bool metric) {
  double c = t10 / 10.0;
  return metric ? js_round(c) : js_round(c * 1.8 + 32);
}

static void fmt_temp(char *out, int16_t t10, bool ok, bool metric) {
  if (ok) snprintf(out, 12, "%d" DEG, temp_value(t10, metric));
  else strcpy(out, NO_VALUE DEG);
}

// Uppercase as JavaScript's toUpperCase for the Latin-1 range
static void to_upper(char *dst, const char *src, int max) {
  int n = 0;
  while (*src && n < max - 5) {
    uint32_t cp = utf8_next(&src);
    if (cp >= 'a' && cp <= 'z') cp -= 32;
    else if (cp == 0xDF) {  // sharp s -> SS
      dst[n++] = 'S';
      cp = 'S';
    } else if (cp == 0xB5) cp = 0x39C;
    else if (cp == 0xFF) cp = 0x178;
    else if (cp >= 0xE0 && cp <= 0xFE && cp != 0xF7) cp -= 32;
    n += utf8_put(dst + n, cp);
  }
  dst[n] = 0;
}

static int iso_week(const struct tm *t) {
  int wday = t->tm_wday ? t->tm_wday : 7;
  int yday = t->tm_yday + 4 - wday;  // day of year of this week's Thursday
  int year = t->tm_year + 1900;
  if (yday < 0) {
    year--;
    bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    yday += leap ? 366 : 365;
  } else {
    bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    int days = leap ? 366 : 365;
    if (yday >= days) yday -= days;
  }
  return yday / 7 + 1;
}

// Widgets.formatDate: strftime-like tokens, "|" is a line break
static void format_date(char *out, int max, const struct tm *t, const char *pattern, bool upper) {
  char buf[160];
  int n = 0;
  for (const char *p = pattern; *p && n < (int)sizeof(buf) - 16; p++) {
    if (*p != '%' || !p[1]) {
      buf[n++] = *p;
      continue;
    }
    char tok[24] = "";
    char c = p[1];
    switch (c) {
      case 'd': pad2(tok, t->tm_mday); break;
      case 'e': snprintf(tok, sizeof(tok), "%d", t->tm_mday); break;
      case 'm': pad2(tok, t->tm_mon + 1); break;
      case 'n': snprintf(tok, sizeof(tok), "%d", t->tm_mon + 1); break;
      case 'b': snprintf(tok, sizeof(tok), "%c%c%c", MONTHS[t->tm_mon][0], MONTHS[t->tm_mon][1] + 32,
                         MONTHS[t->tm_mon][2] + 32); break;
      case 'B': strcpy(tok, MONTHS_LONG[t->tm_mon]); break;
      case 'a': snprintf(tok, sizeof(tok), "%c%c%c", DAYS[t->tm_wday][0], DAYS[t->tm_wday][1] + 32,
                         DAYS[t->tm_wday][2] + 32); break;
      case 'A': strcpy(tok, DAYS_LONG[t->tm_wday]); break;
      case 'y': pad2(tok, (t->tm_year + 1900) % 100); break;
      case 'Y': snprintf(tok, sizeof(tok), "%d", t->tm_year + 1900); break;
      case 'j': snprintf(tok, sizeof(tok), "%d", t->tm_yday + 1); break;
      case 'V': snprintf(tok, sizeof(tok), "%d", iso_week(t)); break;
      case '%': strcpy(tok, "%"); break;
      default:
        // unknown tokens stay as they are; only letters form a token
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) snprintf(tok, sizeof(tok), "%%%c", c);
        else {
          buf[n++] = '%';
          continue;
        }
    }
    int l = strlen(tok);
    memcpy(buf + n, tok, l);
    n += l;
    p++;
  }
  buf[n] = 0;
  if (upper) to_upper(out, buf, max);
  else utf8_copy(out, buf, n, max);
}

// --- layout helpers -------------------------------------------------------------

typedef enum { ITEM_TEXT, ITEM_ICON, ITEM_BATTERY, ITEM_CALENDAR } ItemKind;

typedef struct {
  ItemKind kind;
  int h;
  const char *str;
  int size;
  GColor color;
  bool bold;
  IconId icon;
  // calendar frame
  int bw;
  int dfs;
} Item;

static Item text_item(const G *g, const char *s, int size, GColor color, bool bold) {
  return (Item){.kind = ITEM_TEXT, .h = text_ink_height(s, size, bold), .str = s, .size = size, .color = color,
                .bold = bold};
}

static Item icon_item(IconId icon, int size, GColor color) {
  return (Item){.kind = ITEM_ICON, .h = size, .size = size, .icon = icon, .color = color};
}

static void draw_battery_icon(const G *g, int x, int y, int size, GColor color) {
  g_battery(g, x, y, size, color, g_live.battery, g_live.charging);
}

static void item_draw(const G *g, const Box *box, const Item *it, int y) {
  switch (it->kind) {
    case ITEM_TEXT:
      g_text(g, it->str, g_ax(g, text_measure(it->str, it->size, it->bold)), y, it->size, it->color, it->bold,
             ALIGN_LEFT);
      break;
    case ITEM_ICON:
      g_icon(g, it->icon, g_ax(g, it->size), y, it->size, it->color, GColorClear);
      break;
    case ITEM_BATTERY:
      draw_battery_icon(g, g_ax(g, it->size), y, it->size, it->color);
      break;
    case ITEM_CALENDAR: {
      // filled like an icon; on a fill of its own the number takes the icon
      // stroke color, so it stays readable when the fill matches the text
      int x = g_ax(g, it->bw);
      g_frame(g, x, y, it->bw, it->h, box->accent, 2, 3, g->icon_fill);
      GColor num = gcolor_equal(g->icon_fill, box->bg) ? box->fg : box->accent;
      g_text(g, it->str, x + it->bw / 2.0, y + js_floor((it->h - text_ink_height(it->str, it->dfs, false)) / 2.0),
             it->dfs, num, false, ALIGN_CENTER);
      break;
    }
  }
}

// Stacks items vertically, centered in the block
static void stack(const G *g, const Box *box, const Item *items, int n, int gap) {
  int total = gap * (n - 1);
  for (int i = 0; i < n; i++) total += items[i].h;
  int y = js_floor((g->h - total) / 2.0);
  for (int i = 0; i < n; i++) {
    item_draw(g, box, &items[i], y);
    y += items[i].h + gap;
  }
}

static void center_text(const Box *box, const char *s, double max_h) {
  const G *g = &box->g;
  int size = text_fit(s, g->w - 8, max_h, false);
  Item it = text_item(g, s, size, box->fg, false);
  stack(g, box, &it, 1, 4);
}

static void center_text_default(const Box *box, const char *s) {
  center_text(box, s, box->g.h * 0.7);
}

// What metric() draws as its icon
typedef struct {
  IconId icon;
  bool battery;
} IconSpec;

static void draw_icon_spec(const G *g, const IconSpec *ic, int x, int y, int size, GColor color) {
  if (ic->battery) draw_battery_icon(g, x, y, size, color);
  else g_icon(g, ic->icon, x, y, size, color, GColorClear);
}

// Standard "icon + value (+ label)" layout: stacked in square and tall
// blocks, in a row in wide ones. label may be NULL or "".
static void metric(const Box *box, const G *g, IconSpec ic, const char *value, const char *label) {
  int w = g->w, h = g->h, pad = 4;
  GColor fg = box->fg, accent = box->accent;
  bool has_label = label && *label;
  int lab_h = has_label ? text_ink_height(label, 14, false) + 4 : 0;

  if ((double)w / h >= 1.6) {
    int ics = g_icon_size(h * 0.55);
    int fs = text_fit(value, w - ics - pad * 3, has_label ? h - 8 - lab_h : h * 0.8, false);
    bool show_l = has_label && text_ink_height(value, fs, false) + lab_h <= h - 4;
    int tw = MAX(text_measure(value, fs, false), show_l ? text_measure(label, 14, false) : 0);
    int x0 = g_ax(g, ics + pad + tw);
    draw_icon_spec(g, &ic, x0, js_floor((h - ics) / 2.0), ics, accent);
    int tx = x0 + ics + pad;
    int vh = text_ink_height(value, fs, false);
    int lh = show_l ? text_ink_height(label, 14, false) : 0;
    int ty = js_floor((h - vh - (show_l ? 4 + lh : 0)) / 2.0);
    g_text(g, value, tx, ty, fs, fg, false, ALIGN_LEFT);
    if (show_l) g_text(g, label, tx, ty + vh + 4, 14, fg, false, ALIGN_LEFT);
    return;
  }

  // a 1x1 cell (50x57) fits the native TimeStyle icon size, 25 px
  int icv = g_icon_size(MIN(w * 0.6, h * 0.45));
  int room = h - icv - pad * 3;
  int fsv = text_fit(value, w - pad * 2, MIN(room - lab_h, MAX(18.0, h * 0.32)), false);
  Item items[3];
  int n = 0;
  items[n] = icon_item(ic.icon, icv, accent);
  if (ic.battery) items[n].kind = ITEM_BATTERY;
  n++;
  items[n++] = text_item(g, value, fsv, fg, false);
  if (has_label && text_ink_height(value, fsv, false) + lab_h + 1 <= room) items[n++] = text_item(g, label, 14, fg, false);
  stack(g, box, items, n, 5);
}

static IconSpec simple_icon(IconId icon) {
  return (IconSpec){.icon = icon, .battery = false};
}

// --- widgets --------------------------------------------------------------------

static void draw_time(Box *box) {
  const G *g = &box->g;
  const uint8_t *o = box->b->opt;
  ClockFont font = o[0] <= CLOCK_LECO ? (ClockFont)o[0] : CLOCK_AVENIR;
  bool zero = o[2] & 1, aa = (o[2] >> 1) & 1;
  uint8_t align = box->b->align;
  int w = g->w, h = g->h;

  int hh = box->now.tm_hour;
  if (box->clock12) hh = hh % 12 ? hh % 12 : 12;
  char hs[8], ms[8], slot[12];
  if (zero) pad2(hs, hh);
  else snprintf(hs, sizeof(hs), "%d", hh);
  pad2(ms, box->now.tm_min);
  bool stacked = o[1] == 2 || (o[1] == 0 && h > w * 0.75);
  // margins as in TimeStyle: h/16 top and bottom, h/20 for LECO
  int pad_y = MAX(2, js_round((double)h / (font == CLOCK_LECO ? 20 : 16)));
  int pad_x = 4;
  if (strlen(hs) < 2) snprintf(slot, sizeof(slot), "0%s", hs);
  else strcpy(slot, hs);
  // "right" with a hidden zero: draw "08" without the zero so the digit sits
  // exactly where it does in "08"
  int hide = strcmp(hs, slot) != 0 && align == ALIGN_RIGHT ? 1 : 0;
  if (hide) strcpy(hs, slot);

#define PLACE(line_w, clock_w) \
  (align == ALIGN_LEFT ? (w - (clock_w)) / 2.0 \
   : align == ALIGN_RIGHT ? (w - (clock_w)) / 2.0 + (clock_w) - (line_w) \
   : (w - (clock_w)) / 2.0 + ((clock_w) - (line_w)) / 2)

  if (stacked) {
    ClockInk ih = clock_ink(hs, font), im = clock_ink(ms, font);
    double cw = MAX(clock_ink(slot, font).w, im.w);
    double gap_r = 0.12;
    int em = js_floor(MIN((h - pad_y * 2) / (ih.h + im.h + gap_r), (w - pad_x * 2) / cw));
    int gap = js_round(gap_r * em);
    int top = js_round((h - js_round(ih.h * em) - js_round(im.h * em) - gap) / 2.0);
    ClockPainter p;
    if (clock_begin(&p, g, font, box->fg, aa)) {
      clock_line(&p, g, hs, em, PLACE(ih.w * em, cw * em), top, hide);
      clock_line(&p, g, ms, em, PLACE(im.w * em, cw * em), top + js_round(ih.h * em) + gap, 0);
      clock_end(&p);
    }
    return;
  }
  char line[20], full_s[20];
  snprintf(line, sizeof(line), "%s:%s", hs, ms);
  snprintf(full_s, sizeof(full_s), "%s:%s", slot, ms);
  ClockInk ink = clock_ink(line, font), full = clock_ink(full_s, font);
  int eml = js_floor(MIN((h - pad_y * 2) / ink.h, (w - pad_x * 2) / full.w));
  ClockPainter p;
  if (clock_begin(&p, g, font, box->fg, aa)) {
    clock_line(&p, g, line, eml, PLACE(ink.w * eml, full.w * eml), (h - ink.h * eml) / 2, hide);
    clock_end(&p);
  }
#undef PLACE
}

static void draw_date(Box *box) {
  const G *g = &box->g;
  const struct tm *d = &box->now;
  if (box->b->opt[0] == 0) {
    // as in TimeStyle: weekday, day number in a frame, month
    char day[4], wdmon[8];
    snprintf(day, sizeof(day), "%d", d->tm_mday);
    const char *mon = MONTHS[d->tm_mon], *wd = DAYS[d->tm_wday];
    snprintf(wdmon, sizeof(wdmon), "%s%s", wd, mon);
    int lbl = text_snap(MIN(g->h * 0.16, 28.0));
    int bh = CLAMP(js_round(g->h - text_ink_height(wdmon, lbl, false) * 2 - 14), 16, 90);
    int bw = CLAMP(js_round(bh * 1.3), 24, g->w - 8);
    int dfs = text_fit(day, bw - 6, bh - 6, false);
    Item items[3] = {
      text_item(g, wd, lbl, box->fg, false),
      {.kind = ITEM_CALENDAR, .h = bh, .bw = bw, .dfs = dfs, .str = day},
      text_item(g, mon, lbl, box->fg, false),
    };
    stack(g, box, items, 3, 3);
    return;
  }
  // pattern-based; all lines share one font, the one the longest line fits in
  char text[BLOCK_STR_MAX * 2];
  format_date(text, sizeof(text), d, box->b->str, box->b->opt[1]);
  char *lines[8];
  int n = 0;
  char *p = text;
  lines[n++] = p;
  for (; *p; p++) {
    if (*p == '|' && n < 8) {
      *p = 0;
      lines[n++] = p + 1;
    }
  }
  int gap = 4;
  double line_h = (g->h - 8 - gap * (n - 1)) / (double)n;
  int size = 1000;
  for (int i = 0; i < n; i++) size = MIN(size, text_fit(lines[i], g->w - 8, line_h, false));
  Item items[8];
  for (int i = 0; i < n; i++) items[i] = text_item(g, lines[i], size, box->fg, false);
  stack(g, box, items, n, gap);
}

static void draw_weekday(Box *box) {
  const char *text = DAYS[box->now.tm_wday];
  if (box->b->opt[0]) {
    const char *full = DAYS_LONG[box->now.tm_wday];
    if (text_fit(full, box->g.w - 8, box->g.h, false) >= 18 && text_measure(full, 18, false) <= box->g.w - 8) {
      text = full;
    }
  }
  center_text_default(box, text);
}

static void draw_battery(Box *box) {
  const G *g = &box->g;
  uint8_t st = box->b->opt[0];
  char pct[8];
  snprintf(pct, sizeof(pct), "%d%%", g_live.battery);
  if (st == 0) {
    int s = g_icon_size(MIN(g->w, g->h) * 0.7);
    Item it = icon_item(ICON_BATTERY_FRAME, s, box->accent);
    it.kind = ITEM_BATTERY;
    stack(g, box, &it, 1, 4);
    return;
  }
  if (st == 2) {
    center_text_default(box, pct);
    return;
  }
  metric(box, g, (IconSpec){.battery = true}, pct, NULL);
}

static void draw_bluetooth(Box *box) {
  const G *g = &box->g;
  bool only_lost = box->b->opt[0];
  // the preview shows the disconnected icon for "only when lost"
  bool connected = IS_DEMO ? !only_lost : g_live.connected;
  if (connected && only_lost) return;
  int s = g_icon_size(MIN(g->w, g->h) * 0.5);
  Item it = icon_item(connected ? ICON_BLUETOOTH : ICON_BLUETOOTH_OFF, s, box->accent);
  stack(g, box, &it, 1, 4);
}

static void draw_steps(Box *box) {
  const uint8_t *o = box->b->opt;
  int32_t v = g_live.steps;
  char val[16];
  if (!g_live.steps_ok) strcpy(val, NO_VALUE);
  else if (o[2]) fmt_k(val, v);
  else fmt_thousands(val, v);
  int goal = o[0] | (o[1] << 8);
  // reserve 7 px at the bottom for the goal bar so text does not overlap it
  G mg = box->g;
  if (goal > 0) mg.h = box->g.h - 7;
  metric(box, &mg, simple_icon(ICON_STEPS), val, box->g.h >= 100 ? "steps" : "");
  if (goal > 0) {
    // goal bar: a thin track line and a 3 px thick completed part
    int bw = box->g.w - 12;
    double frac = g_live.steps_ok ? CLAMP((double)v / goal, 0.0, 1.0) : 0;
    g_rect(&box->g, 6, box->g.h - 5, bw, 1, box->fg);
    g_rect(&box->g, 6, box->g.h - 6, js_round(bw * frac), 3, box->accent);
  }
}

static void draw_steps_graph(Box *box) {
  const G *g = &box->g;
  int from = CLAMP(box->b->opt[0], 0, 23);
  int n = MIN(14, 24 - from);
  int max = 1;
  for (int i = 0; i < n; i++) max = MAX(max, g_live.steps_hourly[from + i]);
  int step = js_floor((g->w - 8) / (double)n);
  int x0 = g_ax(g, step * n);
  int gh = g->h - 10;
  for (int i = 0; i < n; i++) {
    int v = g_live.steps_hourly[from + i];
    int bh = MAX(1, js_round((double)gh * v / max));
    g_rect(g, x0 + i * step, 5 + gh - bh, MAX(1, step - 2), bh, box->accent);
  }
}

static void draw_distance(Box *box) {
  double m = g_live.distance_m;
  uint8_t unit = box->b->opt[0];
  if (unit == 0 || unit > 4) unit = box->metric ? 1 : 3;
  char val[16];
  const char *label = "km";
  switch (unit) {
    case 2: fmt_thousands(val, js_round(m)); label = "m"; break;
    case 3: fmt_fixed1(val, m / 1609.344); label = "mi"; break;
    case 4: fmt_thousands(val, js_round(m * 3.28084)); label = "ft"; break;
    default: fmt_fixed1(val, m / 1000); break;
  }
  if (!g_live.distance_ok) strcpy(val, NO_VALUE);
  metric(box, &box->g, simple_icon(ICON_DISTANCE), val, label);
}

static void draw_simple_value(Box *box, IconId icon, bool ok, int32_t v, const char *label) {
  char val[16];
  if (ok) snprintf(val, sizeof(val), "%ld", (long)v);
  else strcpy(val, NO_VALUE);
  metric(box, &box->g, simple_icon(icon), val, label);
}

static void draw_sleep(Box *box) {
  int mins = box->b->opt[0] ? g_live.deep_min : g_live.sleep_min;
  char v[16], mm[4];
  pad2(mm, mins % 60);
  if (box->g.w < 60) snprintf(v, sizeof(v), "%d:%s", mins / 60, mm);
  else snprintf(v, sizeof(v), "%dh %sm", mins / 60, mm);
  if (!(box->b->opt[0] ? g_live.deep_ok : g_live.sleep_ok)) strcpy(v, NO_VALUE);
  metric(box, &box->g, simple_icon(ICON_SLEEP), v, NULL);
}

static void draw_weather(Box *box) {
  bool ok = data_weather_current_ok();
  char t[12];
  fmt_temp(t, g_weather.temp, ok, box->metric);
  metric(box, &box->g, simple_icon(icons_weather(ok ? g_weather.cond : WEATHER_GENERIC)), t, NULL);
}

static void draw_forecast(Box *box) {
  const G *g = &box->g;
  bool ok = data_weather_current_ok();
  char hi[12], lo[12];
  fmt_temp(hi, g_weather.hi, ok, box->metric);
  fmt_temp(lo, g_weather.lo, ok, box->metric);
  IconId icon = icons_weather(ok ? g_weather.fcond : WEATHER_GENERIC);
  if (g->w < 60) {
    int fs = text_fit("88" DEG, g->w - 8, (g->h - 8) / 3.0, false);
    int ic = g_icon_size(g->h * 0.32);
    Item items[3] = {
      icon_item(icon, ic, box->accent),
      text_item(g, hi, fs, box->fg, false),
      text_item(g, lo, fs, box->fg, false),
    };
    stack(g, box, items, 3, 4);
    return;
  }
  char both[24];
  snprintf(both, sizeof(both), "%s/%s", hi, lo);
  metric(box, g, simple_icon(icon), both, NULL);
}

static void draw_uv(Box *box) {
  bool ok = data_weather_current_ok() && g_weather.uv != 255;
  draw_simple_value(box, ICON_UV, ok, g_weather.uv, "UV");
}

static void draw_seconds(Box *box) {
  char s[8];
  snprintf(s, sizeof(s), ":%s%d", box->now.tm_sec < 10 ? "0" : "", box->now.tm_sec);
  center_text_default(box, s);
}

static void draw_alt_tz(Box *box) {
  const G *g = &box->g;
  int off_half = (int8_t)box->b->opt[0];
  time_t t = box->t + off_half * 1800;
  struct tm *u = gmtime(&t);
  int hh = u->tm_hour, mm = u->tm_min;
  if (box->clock12) hh = hh % 12 ? hh % 12 : 12;
  char v[8], lbl[BLOCK_STR_MAX];
  snprintf(v, sizeof(v), "%d:%s%d", hh, mm < 10 ? "0" : "", mm);
  to_upper(lbl, box->b->str, sizeof(lbl));
  Item items[2];
  int n = 0;
  // the label size is fitted with regular metrics but drawn bold, as in the preview
  if (lbl[0]) items[n++] = text_item(g, lbl, MIN(18, text_fit(lbl, g->w - 6, 18, false)), box->accent, true);
  items[n++] = text_item(g, v, text_fit(v, g->w - 8, g->h * 0.45, false), box->fg, false);
  stack(g, box, items, n, 5);
}

static void draw_week(Box *box) {
  const G *g = &box->g;
  char n[12];
  snprintf(n, sizeof(n), "%d", iso_week(&box->now));
  Item items[2] = {
    text_item(g, "WK", 14, box->accent, true),
    text_item(g, n, text_fit(n, g->w - 8, g->h * 0.5, false), box->fg, false),
  };
  stack(g, box, items, 2, 5);
}

static void draw_beats(Box *box) {
  struct tm *u = gmtime(&box->t);
  int secs = (u->tm_hour + 1) * 3600 + u->tm_min * 60 + u->tm_sec;
  int beats = js_floor((secs % 86400) / 86.4);
  char s[8];
  snprintf(s, sizeof(s), "@%03d", beats);
  center_text_default(box, s);
}

static void draw_text(Box *box) {
  if (box->b->str[0]) center_text_default(box, box->b->str);
}

typedef struct {
  char hour[6];
  char temp[10];
  int t;
  bool ok;
  uint8_t cond;
} HourItem;

static void draw_hourly(Box *box) {
  const G *g = &box->g;
  const uint8_t *o = box->b->opt;
  GColor fg = box->fg, acc = box->accent;
  bool graph = o[0] == 1;
  int step = o[1] >= 1 && o[1] <= 3 ? o[1] : 1;
  // a column is no narrower than the hour label and temperature need
  int fit = MAX(1, js_floor((g->w - 8) / (double)(graph ? 20 : 24)));
  int n = MIN(12, o[2] > 0 ? MIN(o[2], fit) : fit);
  int col_w = js_floor((g->w - 8) / (double)n);
  int x0 = g_ax(g, col_w * n);
#define CX(i) (x0 + col_w * (i) + col_w / 2.0)

  HourItem items[12];
  time_t hour_start = box->t - box->now.tm_min * 60 - box->now.tm_sec;
  for (int i = 0; i < n; i++) {
    HourItem *it = &items[i];
    time_t at = hour_start + (1 + i * step) * SECONDS_PER_HOUR;
    int hr = (box->now.tm_hour + 1 + i * step) % 24;
    if (!IS_DEMO) hr = localtime(&at)->tm_hour;
    int16_t t10 = 0;
    it->ok = data_weather_hourly(at, &t10, &it->cond);
    it->t = temp_value(t10, box->metric);
    if (it->ok) snprintf(it->temp, sizeof(it->temp), "%d" DEG, it->t);
    else strcpy(it->temp, NO_VALUE DEG);
    if (box->clock12) snprintf(it->hour, sizeof(it->hour), "%d%c", hr % 12 ? hr % 12 : 12, hr < 12 ? 'a' : 'p');
    else snprintf(it->hour, sizeof(it->hour), "%d", hr);
  }

  int hh = text_ink_height("0123456789", 14, false);
  int ts = g->h >= 90 && col_w >= 30 ? 18 : 14;
  int th = text_ink_height("0123456789" DEG, ts, false);

  if (graph) {
    // temperatures on top, hours at the bottom, a line between them
    int top = 3, bottom = g->h - 3 - hh;
    int g_top = top + th + 5, g_bot = bottom - 5;
    int lo = 10000, hi = -10000;
    for (int k = 0; k < n; k++) {
      if (!items[k].ok) continue;
      lo = MIN(lo, items[k].t);
      hi = MAX(hi, items[k].t);
    }
#define PY(t) js_round(g_bot - (hi == lo ? 0.5 : (double)((t) - lo) / (hi - lo)) * (g_bot - g_top))
    for (int k = 0; k < n; k++) {
      int x = js_round(CX(k));
      if (k && items[k].ok && items[k - 1].ok) {
        g_line(g, js_round(CX(k - 1)), PY(items[k - 1].t), x, PY(items[k].t), acc, 1);
      }
      g_text(g, items[k].temp, x, top, ts, fg, false, ALIGN_CENTER);
      g_text(g, items[k].hour, x, bottom, 14, fg, false, ALIGN_CENTER);
    }
    for (int k = 0; k < n; k++) {
      if (items[k].ok) g_rect(g, js_round(CX(k)) - 1, PY(items[k].t) - 1, 3, 3, acc);
    }
#undef PY
    return;
  }

  // columns: hour, icon (if it fits), temperature
  int room = g->h - hh - th - 10;
  int ic = room >= 14 ? g_icon_size(MIN(col_w - 2, room)) : 0;
  int total = hh + 3 + (ic ? ic + 3 : 0) + th;
  int y = js_floor((g->h - total) / 2.0);
  for (int k = 0; k < n; k++) {
    double x = CX(k);
    g_text(g, items[k].hour, x, y, 14, fg, false, ALIGN_CENTER);
    if (ic) {
      IconId icon = icons_weather(items[k].ok ? items[k].cond : WEATHER_GENERIC);
      g_icon(g, icon, js_round(x - ic / 2.0), y + hh + 3, ic, acc, GColorClear);
    }
    g_text(g, items[k].temp, x, y + hh + 3 + (ic ? ic + 3 : 0), ts, fg, false, ALIGN_CENTER);
  }
#undef CX
}

static void draw_divider(Box *box) {
  const G *g = &box->g;
  const uint8_t *o = box->b->opt;
  bool horiz = o[0] == 1 || (o[0] != 2 && g->w >= g->h);
  int t = o[2] >= 1 && o[2] <= 3 ? o[2] : 1;
  int inset = CLAMP(o[3], 0, 40);
  int len = (horiz ? g->w : g->h) - inset * 2;
  if (len <= 0) return;
  int across = js_floor(((horiz ? g->h : g->w) - t) / 2.0);
  // dashed: 4t dash, 2t gap; dotted: t square, t gap
  uint8_t style = o[1];
  int on = style == LINE_DASHED ? 4 * t : t;
  int period = style == LINE_DASHED ? 6 * t : 2 * t;
  for (int p = 0; p < len; p += style == LINE_SOLID ? len : period) {
    int seg = style == LINE_SOLID ? len : MIN(on, len - p);
    if (horiz) g_rect(g, inset + p, across, seg, t, box->accent);
    else g_rect(g, across, inset + p, t, seg, box->accent);
  }
}

void widget_draw(Box *box) {
  switch (box->b->widget) {
    case WIDGET_TIME: draw_time(box); break;
    case WIDGET_DATE: draw_date(box); break;
    case WIDGET_WEEKDAY: draw_weekday(box); break;
    case WIDGET_BATTERY: draw_battery(box); break;
    case WIDGET_BLUETOOTH: draw_bluetooth(box); break;
    case WIDGET_STEPS: draw_steps(box); break;
    case WIDGET_STEPS_GRAPH: draw_steps_graph(box); break;
    case WIDGET_DISTANCE: draw_distance(box); break;
    case WIDGET_CALORIES: draw_simple_value(box, ICON_CALORIES, g_live.kcal_ok, g_live.kcal, "kcal"); break;
    case WIDGET_HEART: draw_simple_value(box, ICON_HEART, g_live.heart_ok, g_live.heart, "bpm"); break;
    case WIDGET_SLEEP: draw_sleep(box); break;
    case WIDGET_WEATHER: draw_weather(box); break;
    case WIDGET_FORECAST: draw_forecast(box); break;
    case WIDGET_UV: draw_uv(box); break;
    case WIDGET_SECONDS: draw_seconds(box); break;
    case WIDGET_ALT_TZ: draw_alt_tz(box); break;
    case WIDGET_WEEK: draw_week(box); break;
    case WIDGET_BEATS: draw_beats(box); break;
    case WIDGET_TEXT: draw_text(box); break;
    case WIDGET_HOURLY: draw_hourly(box); break;
    case WIDGET_DIVIDER: draw_divider(box); break;
    default: break;
  }
}
