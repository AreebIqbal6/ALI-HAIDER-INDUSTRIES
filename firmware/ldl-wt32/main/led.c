#include "led.h"

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "app.h"
#include "board_wt32_eth01.h"

#define STEP_MS 50

static volatile bool s_pulse;

void led_pulse_ok(void)
{
    s_pulse = true;
}

static void led_task(void *arg)
{
    uint32_t tick = 0;
    for (;;) {
        app_status_t st;
        app_status_get(&st);
        int on;
        if (!st.link_up) {
            on = (tick / 2) % 2; /* 100 ms on / 100 ms off */
        } else if (!st.uplink_ok) {
            on = (tick / 10) % 2; /* 500 ms on / 500 ms off */
        } else if (s_pulse) {
            s_pulse = false;
            gpio_set_level(BOARD_LED_GPIO, 0);
            vTaskDelay(pdMS_TO_TICKS(150));
            on = 1;
        } else {
            on = 1;
        }
        gpio_set_level(BOARD_LED_GPIO, on);
        tick++;
        vTaskDelay(pdMS_TO_TICKS(STEP_MS));
    }
}

void led_start(void)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << BOARD_LED_GPIO,
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&io);
    gpio_set_level(BOARD_LED_GPIO, 0);
    xTaskCreate(led_task, "led", 2048, NULL, 2, NULL);
}
