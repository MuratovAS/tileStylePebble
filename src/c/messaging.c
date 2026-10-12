#include "messaging.h"
#include "data.h"
#include "settings.h"

static ConfigChangedHandler s_on_config;
static AppTimer *s_retry_timer;
static int s_failures;         // consecutive requests without an answer

// Retry delays after a failed send or a request without an answer:
// pkjs may not be ready yet right after launch
static const uint16_t RETRY_SECONDS[] = {5, 15, 30, 60, 120, 300};
#define RETRY_STEPS ((int)(sizeof(RETRY_SECONDS) / sizeof(RETRY_SECONDS[0])))

static uint32_t retry_delay(void) {
  return RETRY_SECONDS[s_failures < RETRY_STEPS ? s_failures : RETRY_STEPS - 1];
}
// How long to wait for weather after a request was delivered
#define ANSWER_TIMEOUT 90

static bool weather_wanted(void) {
  return !IS_DEMO && g_settings.weather_interval > 0 && settings_has_weather_widget();
}

static bool weather_due(void) {
  if (!g_weather.valid) return true;
  int32_t age = (int32_t)(time(NULL) - (time_t)g_weather.fetched);
  return age < 0 || age >= g_settings.weather_interval * 60;
}

static void retry_cb(void *data);

static void schedule_retry(uint32_t seconds) {
  if (s_retry_timer) app_timer_cancel(s_retry_timer);
  s_retry_timer = app_timer_register(seconds * 1000, retry_cb, NULL);
}

static void send_request(void) {
  if (!connection_service_peek_pebble_app_connection()) return;  // retried on the minute tick
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) != APP_MSG_OK) {
    schedule_retry(RETRY_SECONDS[0]);
    return;
  }
  dict_write_int32(it, MESSAGE_KEY_WeatherRequest, 1);
  if (app_message_outbox_send() != APP_MSG_OK) {
    schedule_retry(RETRY_SECONDS[0]);
    return;
  }
  // if no weather arrives, ask again later
  schedule_retry(ANSWER_TIMEOUT + retry_delay());
}

static void retry_cb(void *data) {
  s_retry_timer = NULL;
  if (!weather_wanted() || !weather_due()) {
    s_failures = 0;
    return;
  }
  if (s_failures < RETRY_STEPS) s_failures++;
  send_request();
}

void messaging_check_weather(void) {
  if (!weather_wanted() || !weather_due()) return;
  // a request is in flight or a retry is scheduled
  if (s_retry_timer) return;
  send_request();
}

static void inbox_received(DictionaryIterator *it, void *context) {
  Tuple *t = dict_find(it, MESSAGE_KEY_Config);
  if (t && t->type == TUPLE_BYTE_ARRAY) {
    if (settings_apply_blob(t->value->data, t->length) && s_on_config) s_on_config();
  }
  t = dict_find(it, MESSAGE_KEY_Weather);
  if (t && t->type == TUPLE_BYTE_ARRAY) {
    if (data_set_weather(t->value->data, t->length)) {
      s_failures = 0;
      if (s_retry_timer) {
        app_timer_cancel(s_retry_timer);
        s_retry_timer = NULL;
      }
    }
  }
}

static void outbox_failed(DictionaryIterator *it, AppMessageResult reason, void *context) {
  // pkjs not running yet or the phone did not answer
  schedule_retry(retry_delay());
}

void messaging_init(ConfigChangedHandler on_config) {
  s_on_config = on_config;
  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(2048, 64);
  messaging_check_weather();
}

void messaging_deinit(void) {
  if (s_retry_timer) app_timer_cancel(s_retry_timer);
  s_retry_timer = NULL;
  app_message_deregister_callbacks();
}
