#include "inputs.h"

#include "driver/gpio.h"
#include "driver/pulse_cnt.h"
#include "esp_attr.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "hal/gpio_ll.h"
#include "soc/gpio_struct.h"

#include "board_wt32_eth01.h"

static const char *TAG = "inputs";

#define RING_N 256 /* power of two */
#define PCNT_HIGH 30000

static DRAM_ATTR input_evt_t s_ring[RING_N];
static volatile uint32_t s_head; /* written by ISR only */
static volatile uint32_t s_tail; /* written by consumer only */
static volatile uint32_t s_overruns;

static const gpio_num_t PINS[INPUT_CH_COUNT] = {
    [INPUT_CH_STRT] = BOARD_IN_STRT_GPIO, [INPUT_CH_PP] = BOARD_IN_PP_GPIO,
    [INPUT_CH_WD] = BOARD_IN_WD_GPIO,     [INPUT_CH_FD] = BOARD_IN_FD_GPIO,
    [INPUT_CH_LD] = BOARD_IN_LD_GPIO,     [INPUT_CH_RES] = BOARD_IN_RES_GPIO,
};

static pcnt_unit_handle_t s_unit;
static uint64_t s_total;
static uint32_t s_last_count;

/*
 * Runs from IRAM with ESP_INTR_FLAG_IRAM, so it keeps capturing while the
 * flash cache is disabled during outbox/journal writes. arg packs
 * (pin << 8) | channel so no flash-resident table is touched.
 */
static void IRAM_ATTR edge_isr(void *arg)
{
    const uint32_t a = (uint32_t)arg;
    const uint32_t pin = a >> 8;
    const int64_t t = esp_timer_get_time();
    const uint32_t lvl = gpio_ll_get_level(&GPIO, pin);
    const uint32_t h = s_head;
    const uint32_t next = (h + 1) & (RING_N - 1);
    if (next == __atomic_load_n(&s_tail, __ATOMIC_ACQUIRE)) {
        s_overruns++;
        return;
    }
    s_ring[h].ch = (uint8_t)(a & 0xFF);
    s_ring[h].level = (uint8_t)lvl;
    s_ring[h].t_us = t;
    __atomic_store_n(&s_head, next, __ATOMIC_RELEASE);
}

bool inputs_pop(input_evt_t *e)
{
    const uint32_t t = s_tail;
    if (t == __atomic_load_n(&s_head, __ATOMIC_ACQUIRE)) {
        return false;
    }
    *e = s_ring[t];
    __atomic_store_n(&s_tail, (t + 1) & (RING_N - 1), __ATOMIC_RELEASE);
    return true;
}

uint32_t inputs_overruns(void)
{
    return s_overruns;
}

int inputs_raw_level(input_ch_t ch)
{
    return gpio_get_level(PINS[ch]);
}

uint64_t inputs_picks_total(void)
{
    int c = 0;
    if (s_unit && pcnt_unit_get_count(s_unit, &c) == ESP_OK) {
        /* accum_count keeps c monotonic across hardware overflows; the
         * unsigned difference also survives the int wrap after ~2^31 picks. */
        s_total += (uint32_t)c - s_last_count;
        s_last_count = (uint32_t)c;
    }
    return s_total;
}

static esp_err_t pcnt_setup(void)
{
    pcnt_unit_config_t ucfg = {
        .low_limit = -1,
        .high_limit = PCNT_HIGH,
        .flags.accum_count = 1,
    };
    ESP_RETURN_ON_ERROR(pcnt_new_unit(&ucfg, &s_unit), TAG, "pcnt unit");
    pcnt_glitch_filter_config_t filt = {.max_glitch_ns = BOARD_PCNT_GLITCH_NS};
    ESP_RETURN_ON_ERROR(pcnt_unit_set_glitch_filter(s_unit, &filt), TAG, "pcnt filter");
    pcnt_chan_config_t ccfg = {
        .edge_gpio_num = BOARD_IN_PP_GPIO,
        .level_gpio_num = -1,
    };
    pcnt_channel_handle_t chan;
    ESP_RETURN_ON_ERROR(pcnt_new_channel(s_unit, &ccfg, &chan), TAG, "pcnt channel");
    /* active-low pulse: count the falling (signal ON) edge only */
    ESP_RETURN_ON_ERROR(pcnt_channel_set_edge_action(chan, PCNT_CHANNEL_EDGE_ACTION_HOLD,
                                                     PCNT_CHANNEL_EDGE_ACTION_INCREASE),
                        TAG, "pcnt edge");
    ESP_RETURN_ON_ERROR(pcnt_unit_add_watch_point(s_unit, PCNT_HIGH), TAG, "pcnt watch");
    ESP_RETURN_ON_ERROR(pcnt_unit_enable(s_unit), TAG, "pcnt enable");
    ESP_RETURN_ON_ERROR(pcnt_unit_clear_count(s_unit), TAG, "pcnt clear");
    ESP_RETURN_ON_ERROR(pcnt_unit_start(s_unit), TAG, "pcnt start");
    /* pcnt_new_channel enables the internal pull-up; the board has external
     * 22 k pull-ups, so turn it off again. */
    gpio_pullup_dis(BOARD_IN_PP_GPIO);
    gpio_pulldown_dis(BOARD_IN_PP_GPIO);
    return ESP_OK;
}

esp_err_t inputs_init(uint64_t picks_base)
{
    s_total = picks_base;
    s_last_count = 0;

    uint64_t mask = 0;
    for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
        if (ch != INPUT_CH_PP) {
            mask |= 1ULL << PINS[ch];
        }
    }
    gpio_config_t io = {
        .pin_bit_mask = mask,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_ANYEDGE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&io), TAG, "gpio config");
    ESP_RETURN_ON_ERROR(pcnt_setup(), TAG, "pcnt");

    esp_err_t err = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }
    for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
        if (ch == INPUT_CH_PP) {
            /* same pin also feeds PCNT; ISR only timestamps for rpm */
            gpio_set_intr_type(PINS[ch], GPIO_INTR_NEGEDGE);
        }
        void *arg = (void *)(uintptr_t)(((uint32_t)PINS[ch] << 8) | (uint32_t)ch);
        ESP_RETURN_ON_ERROR(gpio_isr_handler_add(PINS[ch], edge_isr, arg), TAG, "isr add");
        gpio_intr_enable(PINS[ch]);
    }
    ESP_LOGI(TAG, "inputs ready (picks base %llu)", (unsigned long long)picks_base);
    return ESP_OK;
}
