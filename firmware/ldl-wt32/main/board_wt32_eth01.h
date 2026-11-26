/*
 * board_wt32_eth01.h - WT32-ETH01 (ESP32 + LAN8720) pin map for the LDL.
 * Ethernet values are the ones proven by firmware/wt32-eth01-pilot.
 *
 * Inputs: 817-module PC817 optocouplers, signal ON -> GPIO LOW (active-low).
 * External 22 kOhm pull-ups are fitted; internal pull-ups stay disabled
 * (GPIO34-39 have none anyway).
 *
 * Never use GPIO0 (RMII clock in) or GPIO12 (flash voltage strap) at runtime.
 */
#pragma once

#include "driver/gpio.h"

/* ---- Ethernet (LAN8720 RMII) ---- */
#define BOARD_ETH_PHY_ADDR 1
#define BOARD_ETH_MDC_GPIO GPIO_NUM_23
#define BOARD_ETH_MDIO_GPIO GPIO_NUM_18
#define BOARD_ETH_PHY_POWER_GPIO GPIO_NUM_16 /* enables the 50 MHz oscillator */
#define BOARD_ETH_PHY_RESET_GPIO (-1)        /* no dedicated reset line */
#define BOARD_ETH_RMII_CLK_GPIO 0            /* EMAC_CLK_EXT_IN on GPIO0 */
#define BOARD_ETH_POWER_UP_DELAY_MS 20

/* ---- Loom inputs (P9 -> 817 module -> GPIO), all active-low ---- */
#define BOARD_IN_STRT_GPIO GPIO_NUM_36 /* IN1 PI_STRT running         */
#define BOARD_IN_PP_GPIO GPIO_NUM_4    /* IN2 PI_PP pick pulse (PCNT)  */
#define BOARD_IN_WD_GPIO GPIO_NUM_32   /* IN3 PI_WD warp stop          */
#define BOARD_IN_FD_GPIO GPIO_NUM_33   /* IN4 PI_FD filling stop       */
#define BOARD_IN_LD_GPIO GPIO_NUM_35   /* IN5 PI_LD selvedge stop      */
#define BOARD_IN_RES_GPIO GPIO_NUM_39  /* IN6 PI_RES reserve           */
#define BOARD_INPUT_ACTIVE_LEVEL 0

/* ---- Status LED ---- */
#define BOARD_LED_GPIO GPIO_NUM_2 /* active high, 1 kOhm to GND */

/* ---- Signal limits ---- */
#define BOARD_PICK_RATE_MAX_HZ 15
#define BOARD_PCNT_GLITCH_NS 10000 /* ESP32 filter max ~12.7 us @ APB 80 MHz */
#define BOARD_PICK_MIN_PERIOD_US 20000 /* > 50 Hz is impossible: treat as bounce */
