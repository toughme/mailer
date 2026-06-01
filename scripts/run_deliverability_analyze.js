const { createDeliverabilityService } = require('../src/core/services/deliverabilityService');

(async () => {
  const svc = createDeliverabilityService({ accountsService: { getForDiagnostics: async () => [] } });
  try {
    const report = await svc.analyze({ domain: 'timbermart-south.com', dkimSelector: 'default' });
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();
