#include <string.h>

#include "hardware/adc.h"
#include "hardware/i2c.h"
#include "pico/i2c_slave.h"
#include "pico/stdlib.h"

#define I2C_PORT i2c0
#define I2C_SDA_PIN 4
#define I2C_SCL_PIN 5
#define I2C_ADDRESS 0x42
#define I2C_BAUDRATE 100000

#define ACS1_ADC_INPUT 0 // GP26, physical pin 31
#define ACS2_ADC_INPUT 1 // GP27, physical pin 32
#define ACS3_ADC_INPUT 2 // GP28, physical pin 34

#define FRAME_REGISTER 0x10
#define FRAME_VERSION 1
#define STATUS_MQ9_REQUIRES_EXTERNAL_ADC 0x01

typedef struct __attribute__((packed)) {
    uint16_t version;
    uint16_t acs_raw[3];
    uint16_t mq9_raw;
    uint16_t acs_mv[3];
    uint16_t mq9_mv;
    uint32_t sample_ms;
    uint8_t status;
    uint8_t reserved;
} telemetry_frame_t;

static volatile uint8_t register_pointer;
static volatile bool register_pointer_written;
static volatile telemetry_frame_t frame_a;
static volatile telemetry_frame_t frame_b;
static volatile telemetry_frame_t *active_frame = &frame_a;
static telemetry_frame_t *next_frame = (telemetry_frame_t *)&frame_b;

static uint16_t adc_average(uint input) {
    adc_select_input(input);
    uint32_t total = 0;
    for (int i = 0; i < 32; i++) {
        total += adc_read();
        sleep_us(50);
    }
    return (uint16_t)(total / 32);
}

static uint16_t adc_to_mv(uint16_t raw) {
    return (uint16_t)(((uint32_t)raw * 3300u) / 4095u);
}

static uint8_t frame_byte(uint8_t index) {
    const volatile uint8_t *bytes = (const volatile uint8_t *)active_frame;
    return bytes[index % sizeof(telemetry_frame_t)];
}

static void i2c_slave_handler(i2c_inst_t *i2c, i2c_slave_event_t event) {
    switch (event) {
        case I2C_SLAVE_RECEIVE:
            if (!register_pointer_written) {
                register_pointer = i2c_read_byte_raw(i2c);
                register_pointer_written = true;
            } else {
                // This firmware is read-only; consume any extra write bytes.
                (void)i2c_read_byte_raw(i2c);
            }
            break;
        case I2C_SLAVE_REQUEST:
            i2c_write_byte_raw(i2c, register_pointer < FRAME_REGISTER
                ? 0
                : frame_byte((uint8_t)(register_pointer - FRAME_REGISTER)));
            register_pointer++;
            break;
        case I2C_SLAVE_FINISH:
            register_pointer_written = false;
            break;
        default:
            break;
    }
}

static void setup_i2c_slave(void) {
    gpio_init(I2C_SDA_PIN);
    gpio_set_function(I2C_SDA_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(I2C_SDA_PIN);
    gpio_init(I2C_SCL_PIN);
    gpio_set_function(I2C_SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(I2C_SCL_PIN);
    i2c_init(I2C_PORT, I2C_BAUDRATE);
    i2c_slave_init(I2C_PORT, I2C_ADDRESS, &i2c_slave_handler);
}

static void setup_adc(void) {
    adc_init();
    adc_gpio_init(26);
    adc_gpio_init(27);
    adc_gpio_init(28);
}

static void sample(void) {
    telemetry_frame_t next = {0};
    next.version = FRAME_VERSION;
    next.acs_raw[0] = adc_average(ACS1_ADC_INPUT);
    next.acs_raw[1] = adc_average(ACS2_ADC_INPUT);
    next.acs_raw[2] = adc_average(ACS3_ADC_INPUT);
    for (int i = 0; i < 3; i++) next.acs_mv[i] = adc_to_mv(next.acs_raw[i]);
    // RP2040 exposes only three external ADC GPIOs (GP26–GP28).
    // MQ-9 is therefore marked unavailable until an external ADC is added.
    next.mq9_raw = 0;
    next.mq9_mv = 0;
    next.sample_ms = to_ms_since_boot(get_absolute_time());
    next.status = STATUS_MQ9_REQUIRES_EXTERNAL_ADC;
    memcpy((void *)next_frame, &next, sizeof(next));
    active_frame = next_frame;
    next_frame = next_frame == (telemetry_frame_t *)&frame_a
        ? (telemetry_frame_t *)&frame_b
        : (telemetry_frame_t *)&frame_a;
}

int main(void) {
    stdio_init_all();
    setup_adc();
    setup_i2c_slave();
    sleep_ms(100);
    while (true) {
        sample();
        sleep_ms(1000);
    }
}
