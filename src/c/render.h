#pragma once
/*
 * Drawing primitives, a C port of the `g` object of config/js/raster.js.
 * Widgets draw in block coordinates; text uses firmware fonts with the ink
 * metrics of the preview, shapes are drawn row by row in whole pixels, the
 * clock uses fctx with the TimeStyle fonts.
 */
#include <pebble.h>
#include <pebble-fctx/fctx.h>
#include <pebble-fctx/ffont.h>
#include "icons.h"
#include "settings.h"

#define TEXT_SIZE_COUNT 6
extern const int TEXT_SIZES[TEXT_SIZE_COUNT];

typedef enum { CLOCK_AVENIR = 0, CLOCK_BOLD = 1, CLOCK_LECO = 2 } ClockFont;

typedef struct {
  GContext *ctx;
  int w, h;          // block size
  GColor icon_fill;  // default icon fill
  uint8_t align;     // block alignment (Align)
  GPoint origin;     // block position on screen (fctx draws in screen coordinates)
} G;

// --- text in firmware fonts (sizes 14, 18, 24, 28, 30, 42) ---
int text_measure(const char *s, int size, bool bold);
// Vertical ink bounds of a line relative to the line top
void text_ink(const char *s, int size, bool bold, int *top, int *h);
int text_ink_height(const char *s, int size, bool bold);
// The largest size in which s fits into maxW x maxH (by ink height)
int text_fit(const char *s, double max_w, double max_h, bool bold);
// The largest size not larger than px
int text_snap(double px);
// Left edge of content of width cw, respecting the block alignment
int g_ax(const G *g, double cw);
// y is the top of the line's ink; align: ALIGN_CENTER (x is the middle),
// ALIGN_LEFT or ALIGN_RIGHT
void g_text(const G *g, const char *s, double x, double y, int size, GColor color, bool bold, uint8_t align);

// --- icons ---
int g_icon_size(double budget);
// fill = GColorClear uses the block's icon fill
void g_icon(const G *g, IconId icon, double x, double y, int size, GColor stroke, GColor fill);
void g_battery(const G *g, double x, double y, int size, GColor color, int level, bool charging);

// --- shapes ---
void g_rect(const G *g, double x, double y, double w, double h, GColor color);
void g_line(const G *g, int x0, int y0, int x1, int y1, GColor color, int width);
// fill = GColorClear leaves the inside untouched
void g_frame(const G *g, double x, double y, double w, double h, GColor color, int lw, int r, GColor fill);
void fill_round_rect(GContext *ctx, int x, int y, int w, int h, int r, GColor color);

// --- clock digits (fctx) ---
typedef struct {
  double x0, top, w, h;  // at em = 1: x0 from the line start, top above the baseline
} ClockInk;
ClockInk clock_ink(const char *s, ClockFont font);
// All lines of a clock are filled in one fctx context, so its flag buffer is
// allocated once per frame. AA falls back to BW when memory is short.
typedef struct {
  FContext fctx;
  FFont *ff;
  ClockFont font;
  bool ok;
} ClockPainter;
bool clock_begin(ClockPainter *p, const G *g, ClockFont font, GColor color, bool aa);
// left, top: top-left corner of the line's ink; the first `hide` glyphs take
// space but are not drawn
void clock_line(ClockPainter *p, const G *g, const char *s, int em, double left, double top, int hide);
void clock_end(ClockPainter *p);

void render_free_fonts(void);
