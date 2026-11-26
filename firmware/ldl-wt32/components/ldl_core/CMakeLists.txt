# Pure-C core of the loom data logger: no ESP hardware dependencies.
# Built as an ESP-IDF component in the firmware and as a plain static
# library by test/host/CMakeLists.txt.
if(ESP_PLATFORM)
    idf_component_register(
        SRCS "src/ldl_util.c"
             "src/ldl_journal.c"
             "src/ldl_outbox.c"
             "src/ldl_contract.c"
             "src/ldl_classifier.c"
        INCLUDE_DIRS "include"
        REQUIRES json)
endif()
