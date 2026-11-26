idf_component_register(
    SRCS "main.c"
         "app.c"
         "config.c"
         "inputs.c"
         "led.c"
         "net.c"
         "ota.c"
         "statuspage.c"
         "store.c"
         "timesync.c"
         "uplink.c"
    INCLUDE_DIRS "."
    REQUIRES ldl_core json nvs_flash esp_netif esp_eth esp_event esp_timer esp_http_client
             esp_http_server esp_https_ota app_update mbedtls esp_partition esp_driver_gpio
             esp_driver_pcnt console lwip driver)
