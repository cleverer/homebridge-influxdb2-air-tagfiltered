const { InfluxDB } = require('@influxdata/influxdb-client');

module.exports = (api) => {
  api.registerPlatform('InfluxDBMultiSensor', InfluxDBMultiSensorPlatform);
};

class InfluxDBMultiSensorPlatform {
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
    if (!Array.isArray(this.config.sensors)) {
      this.log.error('Configuration error: "sensors" is not an array or is missing.');
      return;
    }

    this.config.sensors.forEach(sensorConfig => {
      const uuid = this.api.hap.uuid.generate(sensorConfig.name);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log('Restoring existing accessory from cache:', existingAccessory.displayName);
        new InfluxDBMultiSensorAccessory(this, existingAccessory, sensorConfig, this.config.globalValues);
      } else {
        this.log('Adding new accessory:', sensorConfig.name);
        const accessory = new this.api.platformAccessory(sensorConfig.name, uuid);
        new InfluxDBMultiSensorAccessory(this, accessory, sensorConfig, this.config.globalValues);
        this.api.registerPlatformAccessories('homebridge-influxdb-multisensor', 'InfluxDBMultiSensor', [accessory]);
      }
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}

class InfluxDBMultiSensorAccessory {
  constructor(platform, accessory, sensorConfig, globalValues) {
    this.platform = platform;
    this.accessory = accessory;
    this.sensorConfig = sensorConfig;
    this.globalValues = globalValues;

    this.accessory.context = {
      value: 0
    };

    // Adding accessory information
    this.accessory.getService(platform.api.hap.Service.AccessoryInformation)
      .setCharacteristic(platform.api.hap.Characteristic.Manufacturer, globalValues.manufacturer)
      .setCharacteristic(platform.api.hap.Characteristic.SerialNumber, globalValues.serialNumber)
      .setCharacteristic(platform.api.hap.Characteristic.Model, globalValues.model);

    // Add services for each measurement
    sensorConfig.measurements.forEach(measurement => {
      const service = this.getServiceByMeasurement(measurement);
      if (service) {
        service.setCharacteristic(platform.api.hap.Characteristic.Name, `${accessory.displayName} ${measurement}`);
      }
    });

    setInterval(() => {
      this.getSensorData();
    }, 60000); // Fetch data every 60 seconds
  }

  getServiceByMeasurement(measurement) {
    const { Service } = this.platform.api.hap;
    const subtype = `${this.accessory.displayName}-${measurement}`;

    switch (measurement) {
      case 'temperature':
        return this.accessory.getServiceById(Service.TemperatureSensor, subtype) || this.accessory.addService(Service.TemperatureSensor, `${this.accessory.displayName} Temperature`, subtype);
      case 'humidity':
        return this.accessory.getServiceById(Service.HumiditySensor, subtype) || this.accessory.addService(Service.HumiditySensor, `${this.accessory.displayName} Humidity`, subtype);
      case 'battery':
        return this.accessory.getServiceById(Service.BatteryService, subtype) || this.accessory.addService(Service.BatteryService, `${this.accessory.displayName} Battery`, subtype);
      default:
        this.platform.log.warn('Unsupported sensor measurement:', measurement);
        return null;
    }
  }

  buildFluxQuery(sensorConfig, field, measurement) {
    var query = `
        from(bucket: "${this.platform.config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r["_field"] == "${field}")
          |> filter(fn: (r) => r["_measurement"] == "${measurement}")`;

    for (const tagname of sensorConfig.tags) {
      query += `
          |> filter(fn: (r) => r["${tagname}"] == "${sensorConfig.tags[tagname]}")`;
    }

    query += `
          |> last()`;

    return query;
  }

  async getSensorData() {
    this.sensorConfig.measurements.forEach(async (measurement) => {
      const fluxQuery = this.buildFluxQuery(this.sensorConfig, measurement);

      this.platform.log('Running query:', fluxQuery);

      try {
        const rows = await this.platform.queryApi.collectRows(fluxQuery);
        this.platform.log('Query results for measurement', measurement, ':', rows);

        rows.forEach(row => {
          let value = row._value;
          if (typeof value === 'string') {
            value = parseFloat(value.replace(',', '.')); // Ensure value is a float
          }
          this.accessory.context.value = value;
          this.updateCharacteristic(measurement, value);
        });
      } catch (error) {
        this.platform.log.error('Error fetching sensor data for measurement', measurement, ':', error);
      }
    });
  }

  updateCharacteristic(measurement, value) {
    const { Characteristic } = this.platform.api.hap;
    const service = this.getServiceByMeasurement(measurement);
    if (!service) return;

    this.platform.log('Updating characteristic for measurement:', measurement, 'with value:', value);

    switch (measurement) {
      case 'temperature':
        service.updateCharacteristic(Characteristic.CurrentTemperature, value);
        break;
      case 'humidity':
        service.updateCharacteristic(Characteristic.CurrentRelativeHumidity, value);
        break;
      case 'battery':
        service.updateCharacteristic(Characteristic.BatteryLevel, value);
        const statusLowBattery = value < 20 ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        service.updateCharacteristic(Characteristic.StatusLowBattery, statusLowBattery);
        break;
      default:
        this.platform.log.warn('Unsupported sensor measurement:', measurement);
    }
  }
}
