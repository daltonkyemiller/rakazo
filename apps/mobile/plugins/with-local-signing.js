const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withLocalSigning(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["com.apple.developer.associated-domains"];
    return cfg;
  });
};
