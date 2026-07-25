cmake_minimum_required(VERSION 3.13)

include($ENV{PICO_SDK_PATH}/external/pico_sdk_import.cmake)

project(pico_adc_i2c C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(pico_adc_i2c
    pico_adc_i2c.c
)

target_link_libraries(pico_adc_i2c
    pico_stdlib
    hardware_adc
    pico_i2c_slave
)

pico_enable_stdio_usb(pico_adc_i2c 1)
pico_enable_stdio_uart(pico_adc_i2c 0)
pico_add_extra_outputs(pico_adc_i2c)
