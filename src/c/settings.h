#pragma once
/*
 * Settings: the blob from protocol.h parsed into structs, persisted as the
 * raw blob, with the first preset of the settings page as the default.
 */
#include <pebble.h>
#include "protocol.h"

#define GRID_N 4
#define SCREEN_W 200
#define SCREEN_H 228
#define BLOCK_STR_MAX 100
#define BLOCK_OPT_MAX 6
#define SETTINGS_BLOB_MAX 2048

typedef enum { ALIGN_CENTER = 0, ALIGN_LEFT = 1, ALIGN_RIGHT = 2 } Align;
typedef enum { LINE_SOLID = 0, LINE_DASHED = 1, LINE_DOTTED = 2 } LineStyle;

typedef struct {
  uint8_t x, y, w, h;               // in grid cells
  uint8_t widget;                   // WidgetId
  uint8_t bg, fg, accent, icon_fill;  // GColor8, 0 = inherit
  uint8_t align;                    // Align
  // Widget options in protocol order, with the page's defaults filled in.
  // String options (date pattern, alt_tz label, text value) are in str;
  // for date opt = {mode, upper}, alt_tz opt = {offset (int8)}.
  uint8_t opt[BLOCK_OPT_MAX];
  char str[BLOCK_STR_MAX];
} BlockConfig;

typedef struct {
  bool clock24, metric, bt_vibe, line_on;
  uint8_t cols[GRID_N], rows[GRID_N];
  uint8_t bg, tile, fg, accent, icon_fill;  // tile/icon_fill 0 = null
  uint8_t gap, radius;
  uint8_t line_width, line_color, line_style;
  uint8_t weather_interval;  // minutes
  uint8_t count;
  BlockConfig blocks[CONFIG_MAX_BLOCKS];
} Settings;

extern Settings g_settings;

// Loads persisted settings or the built-in default
void settings_init(void);

// Parses and validates a blob; on success replaces g_settings and persists
// the blob. Returns false (and keeps the current settings) if it is invalid.
bool settings_apply_blob(const uint8_t *data, int len);

// Pixel rectangle of a block (Widgets.blockPixels)
GRect settings_block_rect(const BlockConfig *b);

// Whether any block shows one of the given widgets
bool settings_has_widget(WidgetId id);
bool settings_has_weather_widget(void);
