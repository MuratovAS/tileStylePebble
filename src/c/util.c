#include "util.h"

double js_sqrt(double v) {
  if (v <= 0) return 0;
  double x = v > 1 ? v : 1;
  for (int i = 0; i < 40; i++) {
    double nx = 0.5 * (x + v / x);
    if (nx == x) break;
    x = nx;
  }
  return x;
}

uint32_t utf8_next(const char **s) {
  const uint8_t *p = (const uint8_t *)*s;
  uint32_t c = p[0];
  int n = 0;
  if (c < 0x80) {
    n = 0;
  } else if ((c & 0xE0) == 0xC0) {
    c &= 0x1F;
    n = 1;
  } else if ((c & 0xF0) == 0xE0) {
    c &= 0x0F;
    n = 2;
  } else if ((c & 0xF8) == 0xF0) {
    c &= 0x07;
    n = 3;
  } else {
    *s += 1;
    return 0xFFFD;
  }
  for (int i = 1; i <= n; i++) {
    if ((p[i] & 0xC0) != 0x80) {
      *s += i;
      return 0xFFFD;
    }
    c = (c << 6) | (p[i] & 0x3F);
  }
  *s += n + 1;
  return c;
}

int utf8_put(char *out, uint32_t cp) {
  if (cp < 0x80) {
    out[0] = (char)cp;
    return 1;
  }
  if (cp < 0x800) {
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  }
  if (cp < 0x10000) {
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
  }
  out[0] = (char)(0xF0 | (cp >> 18));
  out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
  out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
  out[3] = (char)(0x80 | (cp & 0x3F));
  return 4;
}

void utf8_copy(char *dst, const char *src, int src_len, int max) {
  int n = MIN(src_len, max - 1);
  // step back over continuation bytes so a code point is not cut in half
  if (n < src_len) {
    while (n > 0 && (((uint8_t)src[n]) & 0xC0) == 0x80) n--;
  }
  memcpy(dst, src, n);
  dst[n] = 0;
}
