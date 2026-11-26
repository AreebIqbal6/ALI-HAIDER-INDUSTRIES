#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

void run_util_tests(void);
void run_contract_tests(void);
void run_ring_tests(void);
void run_classifier_tests(void);

int main(void)
{
    UNITY_BEGIN();
    run_util_tests();
    run_contract_tests();
    run_ring_tests();
    run_classifier_tests();
    return UNITY_END();
}
