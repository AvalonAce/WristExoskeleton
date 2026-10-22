#include <Arduino.h>
#include <Wire.h>
void setup() {
  Serial.begin(115200);
#if defined(PIN_I2C_POWER)
  pinMode(PIN_I2C_POWER, OUTPUT); digitalWrite(PIN_I2C_POWER, HIGH); delay(50);
#endif
  Wire.begin();
}
void loop() {
  Serial.println("Scanning...");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) Serial.printf("  found 0x%02X\n", a);
  }
  delay(2000);
}