
# Homebridge Influxdb2 Air Tagfiltered ![Static Badge](https://img.shields.io/badge/npm-v9-blue:)




Homebridge InfluxDB2 Air Tagfiltered is a plugin that exposes temperature, humidity, battery level from sensors stored in an InfluxDB v2 database. It collects the latest values using the a configurable list of tagvalues and field as filters in the InfluxDB query, making this data available for integration with Homebridge. This allows for seamless monitoring and control of your sensor data within your smart home ecosystem.

This is a fork of https://github.com/colussim/homebridge-influxdb2-air with the addition of flexible tag filtering.

---

## Install

Install the plugin using:

```bash
npm i -g homebridge-influxdb2-air-tagfiltered
```

## Configure

Add to the `accessories` field of your Homebridge `config.json` file (default location at `~/.homebridge/config.json`) :

```json
{
  ...
  "platforms": [
    {
      "platform": "InfluxDB2AirTagfiltered",
      "name": "InfluxDB Sensors",
      "url": "http://your-influxdb-url:port",
      "token": "your-influxdb-token",
      "organization": "your-influxdb-organization",
      "bucket": "your-influxdb-bucket",
      "globalValues": {
        "manufacturer": "Your Manufacturer",
        "serialNumber": "1234567890",
        "model": "Sensor"
      },
      "sensors": [
        {
          "name": "Temperature Room1",
          "measurements": [
              "temperature",
              "humidity",
              "battery_level"
          ],
          "field": "offset_compensated",
          "tags": {
            "tag-name": "tag-value"
          },
          "manufacturer": "Your Manufacturer",
          "serialNumber": "123456789",
          "model": "Sensor"
      }
      {
          "name": "Temperature Room2",
          "measurements": [
              "temperature",
              "humidity",
              "battery"
          ],
          "field": "actual",
          "tags": {
            "tag-name": "tag-value"
          }
      }
       # Add more sensors here 
      ]
    }
  ]
 } 
```
Learn more at [config_sample.json](./config_sample.json).

## Influx request

+/- example request:
```
from(bucket: "${this.platform.config.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r["<tag-name>"] == "${this.sensorConfig.tags.tagvalue}")
        |> filter(fn: (r) => r["_field"] == "${this.sensorConfig.field}")
        |> last()
    `;
```