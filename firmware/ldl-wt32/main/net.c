#include "net.h"

#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_eth.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/ip4_addr.h"
#include "sdkconfig.h"

#include "app.h"
#include "board_wt32_eth01.h"
#include "config.h"

static const char *TAG = "net";
static esp_netif_t *s_netif;
static esp_eth_handle_t s_eth;
static volatile int64_t s_link_up_at_us; /* 0 = link down */
static volatile bool s_got_ip;
static bool s_static_applied;

void net_device_id(char out[13])
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_ETH);
    snprintf(out, 13, "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void on_eth_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    switch (id) {
    case ETHERNET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "link up");
        s_link_up_at_us = esp_timer_get_time();
        APP_STATUS_UPDATE(st->link_up = true);
        break;
    case ETHERNET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "link down");
        s_link_up_at_us = 0;
        s_got_ip = false;
        APP_STATUS_UPDATE({
            st->link_up = false;
            st->has_ip = false;
        });
        break;
    default:
        break;
    }
}

static void on_got_ip(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    const ip_event_got_ip_t *ev = data;
    char ip[16];
    snprintf(ip, sizeof(ip), IPSTR, IP2STR(&ev->ip_info.ip));
    ESP_LOGI(TAG, "got ip %s", ip);
    s_got_ip = true;
    APP_STATUS_UPDATE({
        st->has_ip = true;
        strlcpy(st->ip, ip, sizeof(st->ip));
    });
}

static bool parse_ip(const char *s, esp_ip4_addr_t *out)
{
    return s && s[0] && esp_netif_str_to_ip4(s, out) == ESP_OK;
}

static void apply_static(void)
{
    ldl_cfg_t c;
    cfg_get(&c);
    esp_netif_ip_info_t info = {0};
    if (!parse_ip(c.static_ip, &info.ip) || !parse_ip(c.netmask, &info.netmask)) {
        return;
    }
    parse_ip(c.gateway, &info.gw);
    esp_netif_dhcpc_stop(s_netif);
    if (esp_netif_set_ip_info(s_netif, &info) != ESP_OK) {
        ESP_LOGE(TAG, "static ip rejected");
        return;
    }
    esp_netif_dns_info_t dns = {0};
    if (parse_ip(c.dns, &dns.ip.u_addr.ip4) || parse_ip(c.gateway, &dns.ip.u_addr.ip4)) {
        dns.ip.type = ESP_IPADDR_TYPE_V4;
        esp_netif_set_dns_info(s_netif, ESP_NETIF_DNS_MAIN, &dns);
    }
    s_static_applied = true;
    s_got_ip = true;
    ESP_LOGW(TAG, "DHCP timeout: using static %s", c.static_ip);
    APP_STATUS_UPDATE({
        st->has_ip = true;
        st->static_ip_used = true;
        strlcpy(st->ip, c.static_ip, sizeof(st->ip));
    });
}

/* Static fallback: if the link is up but DHCP has not answered in time. */
static void net_watch_task(void *arg)
{
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(500));
        const int64_t up = s_link_up_at_us;
        if (up && !s_got_ip && !s_static_applied &&
            esp_timer_get_time() - up > (int64_t)CONFIG_LDL_DHCP_TIMEOUT_S * 1000000) {
            ldl_cfg_t c;
            cfg_get(&c);
            if (c.static_ip[0]) {
                apply_static();
            }
        }
        if (s_static_applied && up && !s_got_ip) {
            /* link bounced: static config is still on the netif */
            s_got_ip = true;
            APP_STATUS_UPDATE(st->has_ip = true);
        }
    }
}

esp_err_t net_init(const char *hostname)
{
    /* LAN8720 oscillator enable: drive high before the EMAC starts, so the
     * 50 MHz clock on GPIO0 appears only after the boot strap was sampled. */
    gpio_config_t pwr = {
        .pin_bit_mask = 1ULL << BOARD_ETH_PHY_POWER_GPIO,
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&pwr);
    gpio_set_level(BOARD_ETH_PHY_POWER_GPIO, 1);
    vTaskDelay(pdMS_TO_TICKS(BOARD_ETH_POWER_UP_DELAY_MS));

    esp_netif_config_t ncfg = ESP_NETIF_DEFAULT_ETH();
    s_netif = esp_netif_new(&ncfg);
    if (!s_netif) {
        return ESP_FAIL;
    }

    eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG();
    eth_esp32_emac_config_t emac = ETH_ESP32_EMAC_DEFAULT_CONFIG();
    emac.smi_gpio.mdc_num = BOARD_ETH_MDC_GPIO;
    emac.smi_gpio.mdio_num = BOARD_ETH_MDIO_GPIO;
    emac.clock_config.rmii.clock_mode = EMAC_CLK_EXT_IN;
    emac.clock_config.rmii.clock_gpio = (emac_rmii_clock_gpio_t)BOARD_ETH_RMII_CLK_GPIO;
    esp_eth_mac_t *mac = esp_eth_mac_new_esp32(&emac, &mac_config);

    eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
    phy_config.phy_addr = BOARD_ETH_PHY_ADDR;
    phy_config.reset_gpio_num = BOARD_ETH_PHY_RESET_GPIO;
    esp_eth_phy_t *phy = esp_eth_phy_new_lan87xx(&phy_config);
    if (!mac || !phy) {
        ESP_LOGE(TAG, "mac/phy alloc failed");
        return ESP_FAIL;
    }

    esp_eth_config_t cfg = ETH_DEFAULT_CONFIG(mac, phy);
    esp_err_t err = esp_eth_driver_install(&cfg, &s_eth);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "driver install: %s", esp_err_to_name(err));
        return err;
    }
    ESP_ERROR_CHECK(esp_netif_attach(s_netif, esp_eth_new_netif_glue(s_eth)));
    ESP_ERROR_CHECK(esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID, on_eth_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, on_got_ip, NULL));
    esp_netif_set_hostname(s_netif, hostname);

    xTaskCreate(net_watch_task, "net_watch", 3072, NULL, 3, NULL);
    return esp_eth_start(s_eth);
}
