const { InfluxDB } = require('@influxdata/influxdb-client');

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
      const uuid = this.api.hap.uuid.generate(sensorConfig.name);
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

    this.service = this.getServiceByField(sensorConfig.field);
    if (this.service) {
      this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, accessory.displayName);
    }

    this.accessory.context = {
      value: 0
    };

    setInterval(() => {
      this.getSensorData();
    }, 60000); // Fetch data every 60 seconds
  }

  getServiceByField(field) {
    const { Service } = this.platform.api.hap;
    switch (field) {
      case 'temperature':
        return this.accessory.getService(Service.TemperatureSensor) || this.accessory.addService(Service.TemperatureSensor);
      case 'humidity':
        return this.accessory.getService(Service.HumiditySensor) || this.accessory.addService(Service.HumiditySensor);
      case 'airQuality':
        return this.accessory.getService(Service.AirQualitySensor) || this.accessory.addService(Service.AirQualitySensor);
      case 'battery':
        return this.accessory.getService(Service.BatteryService) || this.accessory.addService(Service.BatteryService);
      default:
        this.platform.log.warn('Unsupported sensor field:', field);
        return null;
    }
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
        this.updateCharacteristic(this.sensorConfig.field, row._value);
      });
    } catch (error) {
      this.platform.log.error('Error fetching sensor data:', error);
    }
  }

  updateCharacteristic(field, value) {
    const { Characteristic } = this.platform.api.hap;
    switch (field) {
      case 'temperature':
        this.service.updateCharacteristic(Characteristic.CurrentTemperature, value);
        break;
      case 'humidity':
        this.service.updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
        break;
      case 'airQuality':
        this.service.updateCharacteristic(Characteristic.AirQuality, value);
        break;
      case 'battery':
        this.service.updateCharacteristic(Characteristic.BatteryLevel, value);
        // Optional: Update the status low battery characteristic based on value
        const statusLowBattery = value < 20 ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        this.service.updateCharacteristic(Characteristic.StatusLowBattery, statusLowBattery);
        break;
      default:
        this.platform.log.warn('Unsupported sensor field:', field);
    }
  }
}
