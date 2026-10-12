#include "icons.h"

const int ICON_SIZE_LIST[ICON_SIZE_COUNT] = ICON_SIZES;
static const uint32_t RESOURCES[ICON_COUNT][ICON_SIZE_COUNT] = ICON_RESOURCE_TABLE;

// Palette roles of a PNG pixel: transparent, white = fill, black = stroke
typedef enum { ROLE_CLEAR, ROLE_FILL, ROLE_STROKE } Role;

typedef struct {
  GBitmap *bmp;
  uint8_t roles[4];
  uint8_t count;
} CachedIcon;

static CachedIcon s_cache[ICON_COUNT][ICON_SIZE_COUNT];

static int size_index(int size) {
  for (int i = 0; i < ICON_SIZE_COUNT; i++) {
    if (ICON_SIZE_LIST[i] == size) return i;
  }
  return -1;
}

static int palette_size(GBitmapFormat f) {
  switch (f) {
    case GBitmapFormat1BitPalette: return 2;
    case GBitmapFormat2BitPalette: return 4;
    case GBitmapFormat4BitPalette: return 4;  // icons have three colors
    default: return 0;
  }
}

static CachedIcon *load(IconId icon, int si) {
  CachedIcon *c = &s_cache[icon][si];
  if (c->bmp) return c;
  c->bmp = gbitmap_create_with_resource(RESOURCES[icon][si]);
  if (!c->bmp) return NULL;
  c->count = palette_size(gbitmap_get_format(c->bmp));
  GColor *pal = gbitmap_get_palette(c->bmp);
  for (int i = 0; i < c->count && pal; i++) {
    GColor col = pal[i];
    if (col.a == 0) c->roles[i] = ROLE_CLEAR;
    else c->roles[i] = (col.r + col.g + col.b >= 6) ? ROLE_FILL : ROLE_STROKE;
  }
  return c;
}

void icons_draw(GContext *ctx, IconId icon, int size, int x, int y, GColor stroke, GColor fill) {
  int si = size_index(size);
  if (icon >= ICON_COUNT || si < 0) return;
  CachedIcon *c = load(icon, si);
  if (!c) return;
  GColor *pal = gbitmap_get_palette(c->bmp);
  if (pal) {
    for (int i = 0; i < c->count; i++) {
      if (c->roles[i] == ROLE_FILL) pal[i] = fill;
      else if (c->roles[i] == ROLE_STROKE) pal[i] = stroke;
    }
  }
  GRect b = gbitmap_get_bounds(c->bmp);
  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, c->bmp, GRect(x, y, b.size.w, b.size.h));
  graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

void icons_flush(void) {
  for (int i = 0; i < ICON_COUNT; i++) {
    for (int s = 0; s < ICON_SIZE_COUNT; s++) {
      if (s_cache[i][s].bmp) gbitmap_destroy(s_cache[i][s].bmp);
      s_cache[i][s].bmp = NULL;
    }
  }
}

IconId icons_weather(uint8_t condition) {
  static const uint8_t MAP[WEATHER_CONDITION_COUNT] = {
    [WEATHER_GENERIC] = ICON_WEATHER_GENERIC,
    [WEATHER_CLEAR_DAY] = ICON_WEATHER_CLEAR_DAY,
    [WEATHER_CLEAR_NIGHT] = ICON_WEATHER_CLEAR_NIGHT,
    [WEATHER_PARTLY_CLOUDY] = ICON_WEATHER_PARTLY_CLOUDY,
    [WEATHER_PARTLY_CLOUDY_NIGHT] = ICON_WEATHER_PARTLY_CLOUDY_NIGHT,
    [WEATHER_CLOUDY] = ICON_WEATHER_CLOUDY,
    [WEATHER_LIGHT_RAIN] = ICON_WEATHER_LIGHT_RAIN,
    [WEATHER_HEAVY_RAIN] = ICON_WEATHER_HEAVY_RAIN,
    [WEATHER_LIGHT_SNOW] = ICON_WEATHER_LIGHT_SNOW,
    [WEATHER_HEAVY_SNOW] = ICON_WEATHER_HEAVY_SNOW,
    [WEATHER_RAIN_SNOW] = ICON_WEATHER_RAIN_SNOW,
    [WEATHER_THUNDERSTORM] = ICON_WEATHER_THUNDERSTORM,
  };
  return condition < WEATHER_CONDITION_COUNT ? (IconId)MAP[condition] : ICON_WEATHER_GENERIC;
}
