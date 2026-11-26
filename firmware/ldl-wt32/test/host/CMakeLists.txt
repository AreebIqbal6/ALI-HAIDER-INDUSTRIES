# Host (Linux/gcc) unit tests for the pure-C LDL core.
#   cmake -S . -B build && cmake --build build && ./build/ldl_host_tests
# Unity and cJSON are taken from ESP-IDF ($IDF_PATH) unless UNITY_DIR /
# CJSON_DIR are given explicitly.
cmake_minimum_required(VERSION 3.16)
project(ldl_host_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(NOT DEFINED UNITY_DIR)
    set(UNITY_DIR "$ENV{IDF_PATH}/components/unity/unity/src")
endif()
if(NOT DEFINED CJSON_DIR)
    set(CJSON_DIR "$ENV{IDF_PATH}/components/json/cJSON")
endif()
if(NOT EXISTS "${UNITY_DIR}/unity.c")
    message(FATAL_ERROR "Unity not found at ${UNITY_DIR} (set IDF_PATH or UNITY_DIR)")
endif()
if(NOT EXISTS "${CJSON_DIR}/cJSON.c")
    message(FATAL_ERROR "cJSON not found at ${CJSON_DIR} (set IDF_PATH or CJSON_DIR)")
endif()

set(CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../components/ldl_core")
get_filename_component(CONTRACT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../contract/v1/examples" ABSOLUTE)

add_executable(ldl_host_tests
    test_main.c
    test_util.c
    test_contract.c
    test_rings.c
    test_classifier.c
    flash_shim.c
    ${CORE_DIR}/src/ldl_util.c
    ${CORE_DIR}/src/ldl_journal.c
    ${CORE_DIR}/src/ldl_outbox.c
    ${CORE_DIR}/src/ldl_contract.c
    ${CORE_DIR}/src/ldl_classifier.c
    ${UNITY_DIR}/unity.c
    ${CJSON_DIR}/cJSON.c)

target_include_directories(ldl_host_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR} ${CORE_DIR}/include ${UNITY_DIR} ${CJSON_DIR})
target_compile_definitions(ldl_host_tests PRIVATE
    CONTRACT_DIR="${CONTRACT_DIR}" UNITY_INCLUDE_DOUBLE UNITY_SUPPORT_64)
target_compile_options(ldl_host_tests PRIVATE -Wall -Wextra -Wno-unused-parameter -g -fsanitize=address,undefined)
target_link_options(ldl_host_tests PRIVATE -fsanitize=address,undefined)
target_link_libraries(ldl_host_tests PRIVATE m)

enable_testing()
add_test(NAME ldl_host_tests COMMAND ldl_host_tests)
