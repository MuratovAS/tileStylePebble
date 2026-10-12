#pragma once
/*
 * Widgets: one draw function per widget, ports of the render() functions in
 * config/js/widgets.js.
 */
#include <pebble.h>
#include "render.h"
#include "settings.h"

typedef struct {
  G g;
  const BlockConfig *b;
  GColor bg, fg, accent;
  time_t t;          // now, unix time
  struct tm now;     // now, local time
  bool metric;
  bool clock12;
} Box;

void widget_draw(Box *box);
