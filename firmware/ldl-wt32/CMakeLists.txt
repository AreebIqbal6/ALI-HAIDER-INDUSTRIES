cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
# Only build what the firmware needs (no Wi-Fi/BT stacks).
set(COMPONENTS main)
project(ldl-wt32)
