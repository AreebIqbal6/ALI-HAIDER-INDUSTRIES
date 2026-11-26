#include <stdlib.h>
#include <string.h>

#include "ldl_contract.h"
#include "ldl_util.h"
#include "unity.h"

static void test_crc32_known_vector(void)
{
    TEST_ASSERT_EQUAL_HEX32(0xCBF43926u, ldl_crc32(0, "123456789", 9));
    /* chaining */
    uint32_t c = ldl_crc32(0, "12345", 5);
    TEST_ASSERT_EQUAL_HEX32(0xCBF43926u, ldl_crc32(c, "6789", 4));
}

static void test_iso_roundtrip(void)
{
    char buf[LDL_ISO_LEN];
    int64_t ms;
    TEST_ASSERT_TRUE(ldl_iso_parse("2026-11-26T09:15:02.481Z", &ms));
    TEST_ASSERT_EQUAL_INT64(1795684502481LL, ms);
    ldl_iso_format(ms, buf);
    TEST_ASSERT_EQUAL_STRING("2026-11-26T09:15:02.481Z", buf);
    ldl_iso_format(0, buf);
    TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:00.000Z", buf);
    ldl_iso_format(951782400000LL, buf); /* leap day */
    TEST_ASSERT_EQUAL_STRING("2000-02-29T00:00:00.000Z", buf);
    TEST_ASSERT_TRUE(ldl_iso_parse("2026-11-26T09:17:00Z", &ms));
    ldl_iso_format(ms, buf);
    TEST_ASSERT_EQUAL_STRING("2026-11-26T09:17:00.000Z", buf);
    TEST_ASSERT_FALSE(ldl_iso_parse("2026-11-26 garbage", &ms));
    TEST_ASSERT_FALSE(ldl_iso_parse("2026-11-26T09:17:00", &ms)); /* no Z */
}

static void test_uuid7_format(void)
{
    const uint8_t rnd[10] = {0xFF, 0x11, 0xFF, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99};
    char u[LDL_UUID_LEN];
    const uint64_t ms = 0x0193c8a25f10ULL;
    ldl_uuid7_format(u, ms, rnd);
    TEST_ASSERT_EQUAL_size_t(36, strlen(u));
    TEST_ASSERT_EQUAL_STRING("0193c8a2-5f10-7f11-bf33-445566778899", u);
    TEST_ASSERT_TRUE(ldl_uuid7_valid(u));
    TEST_ASSERT_EQUAL_UINT64(ms, ldl_uuid7_ms(u));

    /* golden ids are valid v7 */
    TEST_ASSERT_TRUE(ldl_uuid7_valid("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01"));
    TEST_ASSERT_TRUE(ldl_uuid7_valid("0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80"));
    /* wrong version / variant / case */
    TEST_ASSERT_FALSE(ldl_uuid7_valid("0193c8a2-5f10-4a3b-9c4d-1a2b3c4d5e01"));
    TEST_ASSERT_FALSE(ldl_uuid7_valid("0193c8a2-5f10-7a3b-cc4d-1a2b3c4d5e01"));
    TEST_ASSERT_FALSE(ldl_uuid7_valid("0193C8A2-5F10-7A3B-9C4D-1A2B3C4D5E01"));

    /* random bytes: version and variant always forced, ids time-ordered */
    char prev[LDL_UUID_LEN] = "";
    for (int i = 0; i < 200; i++) {
        uint8_t r[10];
        for (int k = 0; k < 10; k++) {
            r[k] = (uint8_t)rand();
        }
        ldl_uuid7_format(u, 1795684502481ULL + (uint64_t)i, r);
        TEST_ASSERT_TRUE(ldl_uuid7_valid(u));
        TEST_ASSERT_TRUE(strcmp(prev, u) < 0);
        strcpy(prev, u);
    }
}

static void test_backoff(void)
{
    TEST_ASSERT_EQUAL_UINT32(2000, ldl_backoff_ms(0));
    TEST_ASSERT_EQUAL_UINT32(4000, ldl_backoff_ms(1));
    TEST_ASSERT_EQUAL_UINT32(256000, ldl_backoff_ms(7));
    TEST_ASSERT_EQUAL_UINT32(300000, ldl_backoff_ms(8));
    TEST_ASSERT_EQUAL_UINT32(300000, ldl_backoff_ms(1000));
}

void run_util_tests(void)
{
    RUN_TEST(test_crc32_known_vector);
    RUN_TEST(test_iso_roundtrip);
    RUN_TEST(test_uuid7_format);
    RUN_TEST(test_backoff);
}
