/*
 * led.h - status LED on GPIO2.
 *   no Ethernet link            : fast blink (5 Hz)
 *   link, no successful upload  : slow blink (1 Hz) - also after upload errors
 *   uploads OK                  : steady on, short off-pulse per successful batch
 */
#pragma once

void led_start(void);

/** Signal one successful batch (short off-pulse). */
void led_pulse_ok(void);
