#include "data.h"
#include "settings.h"
#include "util.h"

LiveData g_live;
WeatherData g_weather;

static DataChangedHandler s_on_change;

#define PERSIST_KEY_WEATHER 120

time_t data_now(void) {
#ifdef DEMO_TIME
  return (time_t)DEMO_TIME;
#else
  return time(NULL);
#endif
}

#ifdef DEMO_DATA

// MOCK from config/js/widgets.js
static const uint16_t MOCK_HOURLY_STEPS[24] = {0, 0, 0, 0, 0, 0, 120, 840, 610, 230, 180, 420,
                                               760, 310, 260, 540, 380, 0, 0, 0, 0, 0, 0, 0};
// MOCK.hourlyAt(h) for h = 0..23
static const int8_t MOCK_HOURLY_TEMP[24] = {7, 6, 5, 5, 5, 6, 7, 8, 9, 11, 13, 14,
                                            15, 16, 17, 17, 17, 16, 15, 14, 13, 11, 9, 8};
static const uint8_t MOCK_HOURLY_COND[24] = {
  WEATHER_PARTLY_CLOUDY_NIGHT, WEATHER_PARTLY_CLOUDY_NIGHT, WEATHER_CLOUDY, WEATHER_LIGHT_RAIN,
  WEATHER_LIGHT_RAIN, WEATHER_CLOUDY, WEATHER_PARTLY_CLOUDY, WEATHER_CLEAR_DAY,
  WEATHER_PARTLY_CLOUDY, WEATHER_PARTLY_CLOUDY, WEATHER_CLOUDY, WEATHER_LIGHT_RAIN,
  WEATHER_LIGHT_RAIN, WEATHER_CLOUDY, WEATHER_PARTLY_CLOUDY, WEATHER_CLEAR_DAY,
  WEATHER_PARTLY_CLOUDY, WEATHER_PARTLY_CLOUDY, WEATHER_CLOUDY, WEATHER_LIGHT_RAIN,
  WEATHER_LIGHT_RAIN, WEATHER_CLOUDY, WEATHER_PARTLY_CLOUDY_NIGHT, WEATHER_CLEAR_NIGHT};

void data_init(DataChangedHandler on_change) {
  s_on_change = on_change;
  g_live = (LiveData){
    .battery = 70, .charging = false, .connected = true,
    .steps_ok = true, .distance_ok = true, .kcal_ok = true, .heart_ok = true, .sleep_ok = true, .deep_ok = true,
    .hourly_ok = true,
    .steps = 6342, .distance_m = 4380, .kcal = 312, .heart = 72, .sleep_min = 432,
    // the preview approximates deep sleep as 35%
    .deep_min = 151,
  };
  memcpy(g_live.steps_hourly, MOCK_HOURLY_STEPS, sizeof(MOCK_HOURLY_STEPS));
  g_weather = (WeatherData){
    .valid = true, .fetched = (uint32_t)data_now(),
    .temp = 140, .hi = 180, .lo = 90,
    .cond = WEATHER_PARTLY_CLOUDY, .fcond = WEATHER_LIGHT_RAIN, .uv = 4,
  };
}

void data_deinit(void) {}
void data_refresh_health(void) {}

bool data_set_weather(const uint8_t *blob, int len) {
  return false;
}

bool data_weather_current_ok(void) {
  return true;
}

bool data_weather_hourly(time_t t, int16_t *temp, uint8_t *cond) {
  struct tm *tm = localtime(&t);
  *temp = MOCK_HOURLY_TEMP[tm->tm_hour] * 10;
  *cond = MOCK_HOURLY_COND[tm->tm_hour];
  return true;
}

#else  // real data

static void changed(void) {
  if (s_on_change) s_on_change();
}

// --- battery and connection ------------------------------------------------

static void battery_handler(BatteryChargeState st) {
  g_live.battery = st.charge_percent;
  g_live.charging = st.is_charging;
  changed();
}

static void connection_handler(bool connected) {
  bool was = g_live.connected;
  g_live.connected = connected;
  if (was && !connected && g_settings.bt_vibe) vibes_double_pulse();
  changed();
}

// --- health -----------------------------------------------------------------

static bool metric_ok(HealthMetric m, time_t start, time_t end) {
  return health_service_metric_accessible(m, start, end) & HealthServiceAccessibilityMaskAvailable;
}

static void read_sum(HealthMetric m, bool *ok, int32_t *out) {
  time_t start = time_start_of_today(), now = time(NULL);
  *ok = metric_ok(m, start, now);
  *out = *ok ? (int32_t)health_service_sum_today(m) : 0;
}

// Start of local hour h today (correct on DST change days)
static time_t local_hour_start(int h) {
  time_t now = time(NULL);
  struct tm t = *localtime(&now);
  t.tm_hour = h;
  t.tm_min = 0;
  t.tm_sec = 0;
  return mktime(&t);
}

static void read_hour(int h) {
  time_t start = local_hour_start(h), now = time(NULL);
  if (start > now) {
    g_live.steps_hourly[h] = 0;
    return;
  }
  time_t end = h < 23 ? local_hour_start(h + 1) : start + SECONDS_PER_HOUR;
  if (end > now) end = now;
  if (end <= start) {
    g_live.steps_hourly[h] = 0;
    return;
  }
  int32_t v = metric_ok(HealthMetricStepCount, start, end) ? (int32_t)health_service_sum(HealthMetricStepCount, start, end) : 0;
  g_live.steps_hourly[h] = (uint16_t)CLAMP(v, 0, 65535);
}

static void read_movement(void) {
  read_sum(HealthMetricStepCount, &g_live.steps_ok, &g_live.steps);
  read_sum(HealthMetricWalkedDistanceMeters, &g_live.distance_ok, &g_live.distance_m);
  read_sum(HealthMetricActiveKCalories, &g_live.kcal_ok, &g_live.kcal);
  if (settings_has_widget(WIDGET_STEPS_GRAPH)) {
    time_t now = time(NULL);
    read_hour(localtime(&now)->tm_hour);
  }
}

static void read_sleep(void) {
  int32_t s = 0, r = 0;
  read_sum(HealthMetricSleepSeconds, &g_live.sleep_ok, &s);
  read_sum(HealthMetricSleepRestfulSeconds, &g_live.deep_ok, &r);
  g_live.sleep_min = s / 60;
  g_live.deep_min = r / 60;
}

static void read_heart(void) {
  HealthValue v = health_service_peek_current_value(HealthMetricHeartRateBPM);
  g_live.heart_ok = v > 0;
  g_live.heart = v;
}

void data_refresh_health(void) {
  read_movement();
  read_sleep();
  read_heart();
  g_live.hourly_ok = g_live.steps_ok;
  if (settings_has_widget(WIDGET_STEPS_GRAPH)) {
    for (int h = 0; h < 24; h++) read_hour(h);
  }
}

static bool has_movement_widget(void) {
  return settings_has_widget(WIDGET_STEPS) || settings_has_widget(WIDGET_STEPS_GRAPH) ||
         settings_has_widget(WIDGET_DISTANCE) || settings_has_widget(WIDGET_CALORIES);
}

// Redraws only when a shown widget depends on what changed (the heart rate
// can be sampled every second during workouts)
static void health_handler(HealthEventType event, void *context) {
  switch (event) {
    case HealthEventSignificantUpdate:
      data_refresh_health();
      if (has_movement_widget() || settings_has_widget(WIDGET_SLEEP) || settings_has_widget(WIDGET_HEART)) {
        changed();
      }
      break;
    case HealthEventMovementUpdate: {
      int32_t steps = g_live.steps, dist = g_live.distance_m, kcal = g_live.kcal;
      read_movement();
      if (has_movement_widget() &&
          (steps != g_live.steps || dist != g_live.distance_m || kcal != g_live.kcal)) {
        changed();
      }
      break;
    }
    case HealthEventSleepUpdate:
      read_sleep();
      if (settings_has_widget(WIDGET_SLEEP)) changed();
      break;
    case HealthEventHeartRateUpdate: {
      int32_t bpm = g_live.heart;
      bool ok = g_live.heart_ok;
      read_heart();
      if (settings_has_widget(WIDGET_HEART) && (bpm != g_live.heart || ok != g_live.heart_ok)) changed();
      break;
    }
    default:
      break;
  }
}

// --- weather ----------------------------------------------------------------

static int16_t rd16(const uint8_t *p) {
  return (int16_t)(p[0] | (p[1] << 8));
}

static uint32_t rd32(const uint8_t *p) {
  return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool parse_weather(const uint8_t *b, int len, WeatherData *w) {
  if (len < 19 || b[0] != PROTOCOL_VERSION) return false;
  int n = MIN(b[18], WEATHER_MAX_HOURLY);
  if (len < 19 + n * 3) return false;
  w->valid = true;
  w->fetched = rd32(b + 1);
  w->temp = rd16(b + 5);
  w->cond = b[7] < WEATHER_CONDITION_COUNT ? b[7] : WEATHER_GENERIC;
  w->hi = rd16(b + 8);
  w->lo = rd16(b + 10);
  w->fcond = b[12] < WEATHER_CONDITION_COUNT ? b[12] : WEATHER_GENERIC;
  w->uv = b[13];
  w->hourly_start = rd32(b + 14);
  w->hourly_count = n;
  for (int i = 0; i < n; i++) {
    const uint8_t *e = b + 19 + i * 3;
    w->hourly_temp[i] = rd16(e);
    w->hourly_cond[i] = e[2] < WEATHER_CONDITION_COUNT ? e[2] : WEATHER_GENERIC;
  }
  return true;
}

bool data_set_weather(const uint8_t *blob, int len) {
  WeatherData w;
  memset(&w, 0, sizeof(w));
  if (!parse_weather(blob, len, &w)) return false;
  g_weather = w;
  if (len <= PERSIST_DATA_MAX_LENGTH) persist_write_data(PERSIST_KEY_WEATHER, blob, len);
  changed();
  return true;
}

static void load_weather(void) {
  memset(&g_weather, 0, sizeof(g_weather));
  if (!persist_exists(PERSIST_KEY_WEATHER)) return;
  uint8_t buf[PERSIST_DATA_MAX_LENGTH];
  int len = persist_read_data(PERSIST_KEY_WEATHER, buf, sizeof(buf));
  if (len > 0 && !parse_weather(buf, len, &g_weather)) memset(&g_weather, 0, sizeof(g_weather));
}

bool data_weather_current_ok(void) {
  if (!g_weather.valid) return false;
  // conditions older than 3 hours (or two refresh intervals) are not shown
  int32_t max_age = MAX(3 * SECONDS_PER_HOUR, 2 * 60 * g_settings.weather_interval);
  int32_t age = (int32_t)(data_now() - (time_t)g_weather.fetched);
  return age < max_age && age > -SECONDS_PER_HOUR;
}

bool data_weather_hourly(time_t t, int16_t *temp, uint8_t *cond) {
  if (!g_weather.valid || t < (time_t)g_weather.hourly_start) return false;
  uint32_t i = (uint32_t)(t - (time_t)g_weather.hourly_start) / SECONDS_PER_HOUR;
  if (i >= g_weather.hourly_count) return false;
  *temp = g_weather.hourly_temp[i];
  *cond = g_weather.hourly_cond[i];
  return true;
}

// --- init -------------------------------------------------------------------

void data_init(DataChangedHandler on_change) {
  s_on_change = on_change;
  memset(&g_live, 0, sizeof(g_live));
  BatteryChargeState st = battery_state_service_peek();
  g_live.battery = st.charge_percent;
  g_live.charging = st.is_charging;
  g_live.connected = connection_service_peek_pebble_app_connection();
  battery_state_service_subscribe(battery_handler);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = connection_handler});
  load_weather();
  data_refresh_health();
  health_service_events_subscribe(health_handler, NULL);
}

void data_deinit(void) {
  battery_state_service_unsubscribe();
  connection_service_unsubscribe();
  health_service_events_unsubscribe();
}

#endif
