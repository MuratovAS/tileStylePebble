#pragma once
/*
 * Fixed-size two-tone icons (resources/icons/<name>_<size>.png): loaded
 * lazily, cached, recolored through the palette at draw time.
 */
#include <pebble.h>
#include "gen_icons.h"
#include "protocol.h"

extern const int ICON_SIZE_LIST[ICON_SIZE_COUNT];

// Draws an icon with its top-left corner at x, y. size must be one of
// ICON_SIZE_LIST. stroke is the outline color, fill the fill color.
void icons_draw(GContext *ctx, IconId icon, int size, int x, int y, GColor stroke, GColor fill);

// Frees all cached bitmaps
void icons_flush(void);

IconId icons_weather(uint8_t condition);
