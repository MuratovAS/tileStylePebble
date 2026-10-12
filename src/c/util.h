#pragma once
/*
 * Small helpers that reproduce JavaScript number semantics used by the
 * settings page preview (Math.floor, Math.round, Math.ceil on doubles), so the
 * watch layout lands on the same pixels.
 */
#include <pebble.h>

#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define CLAMP(v, lo, hi) MAX((lo), MIN((hi), (v)))

static inline int js_floor(double v) {
  int i = (int)v;
  return (v < (double)i) ? i - 1 : i;
}

static inline int js_ceil(double v) {
  int i = (int)v;
  return (v > (double)i) ? i + 1 : i;
}

// Math.round: halves round up (towards +infinity)
static inline int js_round(double v) {
  return js_floor(v + 0.5);
}

double js_sqrt(double v);

// Decodes one UTF-8 code point and advances *s; invalid bytes yield U+FFFD
uint32_t utf8_next(const char **s);

// Appends the UTF-8 encoding of cp to out (at most 4 bytes), returns length
int utf8_put(char *out, uint32_t cp);

// Copies at most max-1 bytes of a UTF-8 string, never splitting a code point
void utf8_copy(char *dst, const char *src, int src_len, int max);
