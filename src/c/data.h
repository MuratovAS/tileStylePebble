#pragma once
/*
 * Live data for widgets: battery, connection, health and weather.
 *
 * Build with DEMO=1 (pebble build) to replace all of it with the MOCK values
 * of config/js/widgets.js, so screenshots match the settings page preview.
 * DEMO_TIME=<unix seconds> additionally freezes the clock.
 */
#include <pebble.h>
#include "protocol.h"

typedef struct {
  uint8_t battery;        // percent
  bool charging;
  bool connected;

  bool steps_ok, distance_ok, kcal_ok, heart_ok, sleep_ok, deep_ok, hourly_ok;
  int32_t steps;
  int32_t distance_m;
  int32_t kcal;
  int32_t heart;          // bpm
  int32_t sleep_min;      // total sleep today, minutes
  int32_t deep_min;       // restful sleep today, minutes
  uint16_t steps_hourly[24];
} LiveData;

typedef struct {
  bool valid;
  uint32_t fetched;       // unix time
  int16_t temp, hi, lo;   // tenths of a degree Celsius
  uint8_t cond, fcond;    // WeatherCondition
  uint8_t uv;             // 255 = unknown
  uint32_t hourly_start;  // unix time of the first hourly entry
  uint8_t hourly_count;
  int16_t hourly_temp[WEATHER_MAX_HOURLY];
  uint8_t hourly_cond[WEATHER_MAX_HOURLY];
} WeatherData;

extern LiveData g_live;
extern WeatherData g_weather;

// Called when data shown on screen changes
typedef void (*DataChangedHandler)(void);

void data_init(DataChangedHandler on_change);
void data_deinit(void);

// Re-reads health data (on start, config change, hour change)
void data_refresh_health(void);

// Parses and persists a weather blob; returns false if it is invalid
bool data_set_weather(const uint8_t *blob, int len);

// Whether the current conditions / today's forecast are usable
bool data_weather_current_ok(void);

// Hourly forecast entry covering unix time t
bool data_weather_hourly(time_t t, int16_t *temp, uint8_t *cond);

// Current time (frozen in DEMO_TIME builds)
time_t data_now(void);

#ifdef DEMO_DATA
#define IS_DEMO 1
#else
#define IS_DEMO 0
#endif
