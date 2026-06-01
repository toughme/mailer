const { createDomainService } = require('./services/domainService');
const { createAnalyticsService } = require('./services/analyticsService');
const { createComplianceService } = require('./services/complianceService');
const { createDeliverabilityPlannerService } = require('./services/deliverabilityPlannerService');
const { createProxyService } = require('./services/proxyService');

function createOperationsCore({ db, security }) {
  const domainService = createDomainService({ db });

  return {
    domainService,
    analyticsService: createAnalyticsService({ db }),
    complianceService: createComplianceService({ db }),
    deliverabilityPlannerService: createDeliverabilityPlannerService({ db, domainService }),
    proxyService: createProxyService({ db, security })
  };
}

module.exports = { createOperationsCore };
