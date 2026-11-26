/* Journal and outbox ring logic on the in-memory NOR flash shim. */
#include <stdio.h>
#include <string.h>

#include "flash_shim.h"
#include "ldl_journal.h"
#include "ldl_outbox.h"
#include "unity.h"

#define SECTOR 4096

/* ---------------- journal ---------------- */

static void test_journal_empty(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 2 * SECTOR, SECTOR);
    s.mem[5] = 0x00; /* garbage must not be mistaken for a record */
    ldl_journal_t j;
    TEST_ASSERT_FALSE(ldl_journal_open(&j, &s.flash));
    TEST_ASSERT_EQUAL_UINT32(0, j.next_off);
    TEST_ASSERT_EQUAL_INT(0, ldl_journal_append(&j, 1, 42, 10, 20));
    TEST_ASSERT_EQUAL_UINT32(1, s.erases); /* sector 0 erased before first write */
    flash_shim_free(&s);
}

static void test_journal_restore_newest_across_wrap(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 2 * SECTOR, SECTOR); /* 256 slots */
    ldl_journal_t j;
    ldl_journal_open(&j, &s.flash);
    for (uint32_t i = 1; i <= 1000; i++) {
        TEST_ASSERT_EQUAL_INT(0, ldl_journal_append(&j, 3, 1000 + i, i * 10, i * 20));
    }
    /* each sector erased only when entered: ceil(1000/128) = 8 erases */
    TEST_ASSERT_EQUAL_UINT32(8, s.erases);
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);

    ldl_journal_t j2;
    TEST_ASSERT_TRUE(ldl_journal_open(&j2, &s.flash));
    TEST_ASSERT_EQUAL_UINT64(2000, j2.last.picks_total);
    TEST_ASSERT_EQUAL_UINT32(10000, j2.last.run_ms);
    TEST_ASSERT_EQUAL_UINT32(1000, j2.last.seq);
    TEST_ASSERT_EQUAL_UINT32(3, j2.last.boot_id);
    TEST_ASSERT_EQUAL_UINT32(1001, j2.next_seq);
    TEST_ASSERT_EQUAL_UINT32(j.next_off, j2.next_off);

    /* continues seamlessly after reopen */
    TEST_ASSERT_EQUAL_INT(0, ldl_journal_append(&j2, 4, 5000, 0, 0));
    ldl_journal_t j3;
    TEST_ASSERT_TRUE(ldl_journal_open(&j3, &s.flash));
    TEST_ASSERT_EQUAL_UINT64(5000, j3.last.picks_total);
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

static void test_journal_corrupt_newest_falls_back(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 2 * SECTOR, SECTOR);
    ldl_journal_t j;
    ldl_journal_open(&j, &s.flash);
    for (uint32_t i = 1; i <= 10; i++) {
        ldl_journal_append(&j, 1, i, 0, 0);
    }
    /* flip a bit in the newest record's picks (slot 9) */
    s.mem[9 * 32 + 12] ^= 0x01;
    ldl_journal_t j2;
    TEST_ASSERT_TRUE(ldl_journal_open(&j2, &s.flash));
    TEST_ASSERT_EQUAL_UINT64(9, j2.last.picks_total);
    /* the dirty slot is skipped: next write goes to a fresh sector */
    TEST_ASSERT_EQUAL_UINT32(SECTOR, j2.next_off);
    TEST_ASSERT_EQUAL_INT(0, ldl_journal_append(&j2, 2, 11, 0, 0));
    ldl_journal_t j3;
    TEST_ASSERT_TRUE(ldl_journal_open(&j3, &s.flash));
    TEST_ASSERT_EQUAL_UINT64(11, j3.last.picks_total);
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

/* ---------------- outbox ---------------- */

static int payload(char *buf, size_t cap, uint32_t n, size_t pad)
{
    int len = snprintf(buf, cap, "{\"n\":%u,\"pad\":\"", n);
    for (size_t i = 0; i < pad && (size_t)len + 3 < cap; i++) {
        buf[len++] = 'x';
    }
    buf[len++] = '"';
    buf[len++] = '}';
    buf[len] = '\0';
    return len;
}

static uint32_t payload_n(ldl_outbox_t *ob, const ldl_outbox_item_t *it)
{
    char buf[LDL_OUTBOX_MAX_PAYLOAD + 1];
    TEST_ASSERT_EQUAL_INT(it->len, ldl_outbox_read(ob, it, buf, sizeof(buf)));
    unsigned n = 0;
    TEST_ASSERT_EQUAL_INT(1, sscanf(buf, "{\"n\":%u", &n));
    return n;
}

static void test_outbox_append_ack_replay(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 4 * SECTOR, SECTOR);
    ldl_outbox_t ob;
    TEST_ASSERT_EQUAL_UINT32(0, ldl_outbox_open(&ob, &s.flash));
    char buf[256];
    for (uint32_t i = 1; i <= 5; i++) {
        int len = payload(buf, sizeof(buf), i, 50);
        TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob, 7, buf, (uint16_t)len));
    }
    TEST_ASSERT_EQUAL_UINT32(5, ldl_outbox_backlog(&ob));

    /* iterate in order */
    ldl_outbox_item_t it, nx;
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob, &it));
    uint32_t expect = 1;
    do {
        TEST_ASSERT_EQUAL_UINT32(expect, payload_n(&ob, &it));
        TEST_ASSERT_EQUAL_UINT32(7, it.boot_id);
        expect++;
        if (!ldl_outbox_next(&ob, &it, &nx)) {
            break;
        }
        it = nx;
    } while (1);
    TEST_ASSERT_EQUAL_UINT32(6, expect);

    /* ack the first two (rid 1..2) */
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob, &it));
    TEST_ASSERT_TRUE(ldl_outbox_next(&ob, &it, &nx));
    TEST_ASSERT_EQUAL_UINT32(2, ldl_outbox_ack_through(&ob, nx.rid));
    TEST_ASSERT_EQUAL_UINT32(3, ldl_outbox_backlog(&ob));

    /* "reboot": unacked records are replayed from #3 */
    ldl_outbox_t ob2;
    TEST_ASSERT_EQUAL_UINT32(3, ldl_outbox_open(&ob2, &s.flash));
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob2, &it));
    TEST_ASSERT_EQUAL_UINT32(3, payload_n(&ob2, &it));
    TEST_ASSERT_EQUAL_UINT32(ob.next_rid, ob2.next_rid);
    TEST_ASSERT_EQUAL_UINT32(ob.wp, ob2.wp);

    /* ack everything -> empty, survives reboot */
    TEST_ASSERT_EQUAL_UINT32(3, ldl_outbox_ack_through(&ob2, ob2.next_rid - 1));
    TEST_ASSERT_EQUAL_UINT32(0, ldl_outbox_backlog(&ob2));
    TEST_ASSERT_FALSE(ldl_outbox_first(&ob2, &it));
    ldl_outbox_t ob3;
    TEST_ASSERT_EQUAL_UINT32(0, ldl_outbox_open(&ob3, &s.flash));
    int len = payload(buf, sizeof(buf), 6, 10);
    TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob3, 8, buf, (uint16_t)len));
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob3, &it));
    TEST_ASSERT_EQUAL_UINT32(6, payload_n(&ob3, &it));
    TEST_ASSERT_EQUAL_UINT32(6, it.rid);
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

static void test_outbox_wrap_overflow_drops_oldest(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 4 * SECTOR, SECTOR);
    ldl_outbox_t ob;
    ldl_outbox_open(&ob, &s.flash);
    char buf[600];
    const uint32_t total = 100; /* ~520 B each, 7 per sector, ring holds < 28 */
    for (uint32_t i = 1; i <= total; i++) {
        int len = payload(buf, sizeof(buf), i, 490);
        TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob, 1, buf, (uint16_t)len));
        TEST_ASSERT_EQUAL_UINT32(i, ldl_outbox_backlog(&ob) + ob.dropped);
    }
    TEST_ASSERT_TRUE(ob.dropped > 0);
    TEST_ASSERT_TRUE(ldl_outbox_backlog(&ob) >= 3 * 7);

    /* remaining records are the newest, contiguous and in order */
    ldl_outbox_item_t it, nx;
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob, &it));
    uint32_t expect = total - ldl_outbox_backlog(&ob) + 1;
    uint32_t seen = 0;
    do {
        TEST_ASSERT_EQUAL_UINT32(expect + seen, payload_n(&ob, &it));
        seen++;
        if (!ldl_outbox_next(&ob, &it, &nx)) {
            break;
        }
        it = nx;
    } while (seen < 1000);
    TEST_ASSERT_EQUAL_UINT32(ldl_outbox_backlog(&ob), seen);

    /* reopen reproduces the same view */
    ldl_outbox_t ob2;
    TEST_ASSERT_EQUAL_UINT32(ldl_outbox_backlog(&ob), ldl_outbox_open(&ob2, &s.flash));
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob2, &it));
    TEST_ASSERT_EQUAL_UINT32(expect, payload_n(&ob2, &it));
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

static void test_outbox_partial_ack_while_appending(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 4 * SECTOR, SECTOR);
    ldl_outbox_t ob;
    ldl_outbox_open(&ob, &s.flash);
    char buf[600];
    uint32_t next = 1, delivered = 0, n_delivered = 0;
    /* steady state: append 3, deliver 2, repeatedly, across many wraps */
    for (int round = 0; round < 200; round++) {
        for (int k = 0; k < 3; k++, next++) {
            int len = payload(buf, sizeof(buf), next, 200);
            TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob, 1, buf, (uint16_t)len));
        }
        for (int k = 0; k < 2; k++) {
            ldl_outbox_item_t it;
            if (!ldl_outbox_first(&ob, &it)) {
                break;
            }
            uint32_t n = payload_n(&ob, &it);
            TEST_ASSERT_TRUE(n > delivered); /* strictly increasing, never repeats */
            delivered = n;
            n_delivered++;
            TEST_ASSERT_EQUAL_UINT32(1, ldl_outbox_ack_through(&ob, it.rid));
        }
    }
    TEST_ASSERT_EQUAL_UINT32(next - 1, n_delivered + ldl_outbox_backlog(&ob) + ob.dropped);
    TEST_ASSERT_TRUE(ob.dropped > 0); /* backlog grows 1/round: ring must have overflowed */
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

static void test_outbox_torn_write_recovers(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 4 * SECTOR, SECTOR);
    ldl_outbox_t ob;
    ldl_outbox_open(&ob, &s.flash);
    char buf[256];
    for (uint32_t i = 1; i <= 3; i++) {
        int len = payload(buf, sizeof(buf), i, 20);
        ldl_outbox_append(&ob, 1, buf, (uint16_t)len);
    }
    /* power loss: payload written, header not */
    s.fail_after = 1;
    int len = payload(buf, sizeof(buf), 4, 20);
    TEST_ASSERT_TRUE(ldl_outbox_append(&ob, 1, buf, (uint16_t)len) < 0);
    s.fail_after = -1;

    ldl_outbox_t ob2;
    TEST_ASSERT_EQUAL_UINT32(3, ldl_outbox_open(&ob2, &s.flash));
    /* dirty tail skipped: next write starts on a fresh sector */
    TEST_ASSERT_EQUAL_UINT32(SECTOR, ob2.wp);
    len = payload(buf, sizeof(buf), 5, 20);
    TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob2, 2, buf, (uint16_t)len));
    ldl_outbox_t ob3;
    TEST_ASSERT_EQUAL_UINT32(4, ldl_outbox_open(&ob3, &s.flash));
    ldl_outbox_item_t it, nx;
    TEST_ASSERT_TRUE(ldl_outbox_first(&ob3, &it));
    for (int i = 0; i < 3; i++) {
        TEST_ASSERT_TRUE(ldl_outbox_next(&ob3, &it, &nx));
        it = nx;
    }
    TEST_ASSERT_EQUAL_UINT32(5, payload_n(&ob3, &it));
    TEST_ASSERT_EQUAL_UINT32(0, s.violations);
    flash_shim_free(&s);
}

static void test_outbox_rejects_bad_sizes(void)
{
    flash_shim_t s;
    flash_shim_init(&s, 2 * SECTOR, SECTOR);
    ldl_outbox_t ob;
    ldl_outbox_open(&ob, &s.flash);
    static char big[LDL_OUTBOX_MAX_PAYLOAD + 1];
    memset(big, 'a', sizeof(big));
    TEST_ASSERT_TRUE(ldl_outbox_append(&ob, 1, big, 0) < 0);
    TEST_ASSERT_TRUE(ldl_outbox_append(&ob, 1, big, sizeof(big)) < 0);
    TEST_ASSERT_EQUAL_INT(0, ldl_outbox_append(&ob, 1, big, LDL_OUTBOX_MAX_PAYLOAD));
    flash_shim_free(&s);
}

void run_ring_tests(void)
{
    RUN_TEST(test_journal_empty);
    RUN_TEST(test_journal_restore_newest_across_wrap);
    RUN_TEST(test_journal_corrupt_newest_falls_back);
    RUN_TEST(test_outbox_append_ack_replay);
    RUN_TEST(test_outbox_wrap_overflow_drops_oldest);
    RUN_TEST(test_outbox_partial_ack_while_appending);
    RUN_TEST(test_outbox_torn_write_recovers);
    RUN_TEST(test_outbox_rejects_bad_sizes);
}
