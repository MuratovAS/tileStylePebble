#pragma once
/*
 * AppMessage: Config and Weather blobs from the phone, WeatherRequest to it.
 */
#include <pebble.h>

typedef void (*ConfigChangedHandler)(void);

void messaging_init(ConfigChangedHandler on_config);
void messaging_deinit(void);

// Called every minute and after a config change: requests weather when the
// layout shows it and the data is older than the refresh interval
void messaging_check_weather(void);
