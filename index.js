const { InfluxDB } = require('@influxdata/influxdb-client');
const { API, Service, Characteristic, UUIDGen } = require('homebridge');

module.exports = (api) => {
  api.registerPlatform('InfluxDBSensor', InfluxDBSensorPlatform);
};

class InfluxDBSensorPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.influxDB = new InfluxDB({ url: this.config.url, token: this.config.token });
    this.queryApi = this.influxDB.getQueryApi(this.config.organization);

    this.accessories = [];

    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.log('DidFinishLaunching');
        this.discoverDevices();
      });
    }
  }

  discoverDevices() {
    this.config.sensors.forEach(sensorConfig => {
      const uuid = UUIDGen.generate(sensorConfig.name);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log('Restoring existing accessory from cache:', existingAccessory.displayName);
        new InfluxDBSensorAccessory(this, existingAccessory, sensorConfig);
      } else {
        this.log('Adding new accessory:', sensorConfig.name);
        const accessory = new this.api.platformAccessory(sensorConfig.name, uuid);
        new InfluxDBSensorAccessory(this, accessory, sensorConfig);
        this.api.registerPlatformAccessories('homebridge-influxdb-sensor', 'InfluxDBSensor', [accessory]);
      }
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}

class InfluxDBSensorAccessory {
  constructor(platform, accessory, sensorConfig) {
    this.platform = platform;
    this.accessory = accessory;
    this.sensorConfig = sensorConfig;

    this.service = this.accessory.getService(Service.TemperatureSensor) || this.accessory.addService(Service.TemperatureSensor);
    this.service.setCharacteristic(Characteristic.Name, accessory.displayName);

    this.accessory.context = {
      value: 0
    };

    setInterval(() => {
      this.getSensorData();
    }, 60000); // Fetch data every 60 seconds
  }

  async getSensorData() {
    const fluxQuery = `
      from(bucket: "${this.platform.config.bucket}")
        |> range(start: -1m)
        |> filter(fn: (r) => r["topic"] == "${this.sensorConfig.topic}")
        |> filter(fn: (r) => r["_field"] == "${this.sensorConfig.field}")
        |> last()
    `;

    try {
      const rows = await this.platform.queryApi.collectRows(fluxQuery);
      rows.forEach(row => {
        this.accessory.context.value = row._value;
        if (this.sensorConfig.field === 'temperature') {
          this.service.updateCharacteristic(Characteristic.CurrentTemperature, row._value);
        } else if (this.sensorConfig.field === 'humidity') {
          // Add humidity service and update characteristic
        } else if (this.sensorConfig.field === 'airQuality') {
          // Add air quality service and update characteristic
        } else if (this.sensorConfig.field === 'batteryLevel') {
          // Add battery service and update characteristic
        }
      });
    } catch (error) {
      this.platform.log.error('Error fetching sensor data:', error);
    }
  }
}

