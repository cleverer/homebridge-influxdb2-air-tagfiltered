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

    let serviceType;
    switch (sensorConfig.field) {
      case 'temperature':
        serviceType = this.platform.api.hap.Service.TemperatureSensor;
        break;
      case 'humidity':
        serviceType = this.platform.api.hap.Service.HumiditySensor;
        break;
      case 'airQuality':
        serviceType = this.platform.api.hap.Service.AirQualitySensor;
        break;
      case 'batteryLevel':
        serviceType = this.platform.api.hap.Service.BatteryService;
        break;
      default:
        this.platform.log.warn('Unsupported sensor field:', sensorConfig.field);
        return;
    }

    this.service = this.accessory.getService(serviceType) || this.accessory.addService(serviceType);
    this.service.setCharacteristic(this.platform.api.hap.Characteristic.Name, accessory.displayName);

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
        |> range(start: 0)
        |> filter(fn: (r) => r["topic"] == "${this.sensorConfig.topic}")
        |> filter(fn: (r) => r["_field"] == "${this.sensorConfig.field}")
        |> last()
    `;

    try {
      const rows = await this.platform.queryApi.collectRows(fluxQuery);
      rows.forEach(row => {
        this.accessory.context.value = row._value;
        switch (this.sensorConfig.field) {
          case 'temperature':
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.CurrentTemperature, row._value);
            break;
          case 'humidity':
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.CurrentRelativeHumidity, row._value);
            break;
          case 'airQuality':
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.AirQuality, row._value);
            break;
          case 'batteryLevel':
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.BatteryLevel, row._value);
            break;
        }
      });
    } catch (error) {
      this.platform.log.error('Error fetching sensor data:', error);
    }
  }
}
