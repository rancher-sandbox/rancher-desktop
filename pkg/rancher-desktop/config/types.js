// --------------------------------------
// 1. Provided by Steve and always potentially available
// --------------------------------------

// Standalone steve
// Base: /v1
export const STEVE = {
  PREFERENCE: 'userpreference',
  CLUSTER:    'cluster',
};

// Auth (via Norman)
// Base: /v3
export const NORMAN = {
  AUTH_CONFIG:                   'authconfig',
  ETCD_BACKUP:                   'etcdbackup',
  CLUSTER_TOKEN:                 'clusterregistrationtoken',
  CLUSTER_ROLE_TEMPLATE_BINDING: 'clusterRoleTemplateBinding',
  GROUP:                         'group',
  PRINCIPAL:                     'principal',
  PROJECT:                       'project',
  SPOOFED:                       { GROUP_PRINCIPAL: 'group.principal' },
  TOKEN:                         'token',
  USER:                          'user',
};

// Public (via Norman)
// Base: /v3-public
export const PUBLIC = { AUTH_PROVIDER: 'authprovider' };

// Common native k8s types (via Steve)
// Base: /k8s/clusters/<id>/v1/
export const API_GROUP = 'apiGroups';
export const API_SERVICE = 'apiregistration.k8s.io.apiservice';
export const CONFIG_MAP = 'configmap';
export const COUNT = 'count';
export const EVENT = 'event';
export const ENDPOINTS = 'endpoints';
export const HPA = 'autoscaling.horizontalpodautoscaler';
export const INGRESS = 'networking.k8s.io.ingress';
export const NAMESPACE = 'namespace';
export const NODE = 'node';
export const NETWORK_POLICY = 'networking.k8s.io.networkpolicy';
export const POD = 'pod';
export const PV = 'persistentvolume';
export const PVC = 'persistentvolumeclaim';
export const RESOURCE_QUOTA = 'resourcequota';
export const SCHEMA = 'schema';
export const SERVICE = 'service';
export const SECRET = 'secret';
export const SERVICE_ACCOUNT = 'serviceaccount';
export const STORAGE_CLASS = 'storage.k8s.io.storageclass';
export const OBJECT_META = 'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta';

export const RBAC = {
  ROLE:                 'rbac.authorization.k8s.io.role',
  CLUSTER_ROLE:         'rbac.authorization.k8s.io.clusterrole',
  ROLE_BINDING:         'rbac.authorization.k8s.io.rolebinding',
  CLUSTER_ROLE_BINDING: 'rbac.authorization.k8s.io.clusterrolebinding',
};

export const WORKLOAD = 'workload';

// The types that are aggregated into a "workload"
export const WORKLOAD_TYPES = {
  DEPLOYMENT:             'apps.deployment',
  CRON_JOB:               'batch.cronjob',
  DAEMON_SET:             'apps.daemonset',
  JOB:                    'batch.job',
  STATEFUL_SET:           'apps.statefulset',
  REPLICA_SET:            'apps.replicaset',
  REPLICATION_CONTROLLER: 'replicationcontroller',
};

const {
  DAEMON_SET, CRON_JOB, JOB, ...scalableWorkloads
} = WORKLOAD_TYPES;

export const SCALABLE_WORKLOAD_TYPES = scalableWorkloads;

export const METRIC = {
  NODE: 'metrics.k8s.io.nodemetrics',
  POD:  'metrics.k8s.io.podmetrics',
};

export const CATALOG = {
  CLUSTER_REPO: 'catalog.cattle.io.clusterrepo',
  OPERATION:    'catalog.cattle.io.operation',
  APP:          'catalog.cattle.io.app',
  REPO:         'catalog.cattle.io.repo',
};

export const MONITORING = {
  ALERTMANAGER:   'monitoring.coreos.com.alertmanager',
  PODMONITOR:     'monitoring.coreos.com.podmonitor',
  PROMETHEUS:     'monitoring.coreos.com.prometheus',
  PROMETHEUSRULE: 'monitoring.coreos.com.prometheusrule',
  SERVICEMONITOR: 'monitoring.coreos.com.servicemonitor',
  THANOSRULER:    'monitoring.coreos.com.thanosruler',
  SPOOFED:        {
    RECEIVER:             'monitoring.coreos.com.receiver',
    RECEIVER_SPEC:        'monitoring.coreos.com.receiver.spec',
    RECEIVER_EMAIL:       'monitoring.coreos.com.receiver.email',
    RECEIVER_SLACK:       'monitoring.coreos.com.receiver.slack',
    RECEIVER_WEBHOOK:     'monitoring.coreos.com.receiver.webhook',
    RECEIVER_PAGERDUTY:   'monitoring.coreos.com.receiver.pagerduty',
    RECEIVER_OPSGENIE:    'monitoring.coreos.com.receiver.opsgenie',
    RECEIVER_HTTP_CONFIG: 'monitoring.coreos.com.receiver.httpconfig',
    RESPONDER:            'monitoring.coreos.com.receiver.responder',
    ROUTE:                'monitoring.coreos.com.route',
    ROUTE_SPEC:           'monitoring.coreos.com.route.spec',
  },
};

export const LONGHORN = {
  ENGINES:       'longhorn.io.engine',
  ENGINE_IMAGES: 'longhorn.io.engineimage',
  NODES:         'longhorn.io.node',
  REPLICAS:      'longhorn.io.replica',
  SETTINGS:      'longhorn.io.setting',
  VOLUMES:       'longhorn.io.volume',
};

// --------------------------------------
// 2. Only if Rancher is installed
// --------------------------------------

// Rancher Management API (via Steve)
// Base: /v1
export const MANAGEMENT = {
  AUTH_CONFIG:                   'management.cattle.io.authconfig',
  CATALOG_TEMPLATE:              'management.cattle.io.catalogtemplate',
  CATALOG:                       'management.cattle.io.catalog',
  CLUSTER:                       'management.cattle.io.cluster',
  CLUSTER_ROLE_TEMPLATE_BINDING: 'management.cattle.io.clusterroletemplatebinding',
  FEATURE:                       'management.cattle.io.feature',
  GROUP:                         'management.cattle.io.group',
  KONTAINER_DRIVER:              'management.cattle.io.kontainerdriver',
  NODE_DRIVER:                   'management.cattle.io.nodedriver',
  NODE_POOL:                     'management.cattle.io.nodepool',
  NODE_TEMPLATE:                 'management.cattle.io.nodetemplate',
  PROJECT:                       'management.cattle.io.project',
  PROJECT_ROLE_TEMPLATE_BINDING: 'management.cattle.io.projectroletemplatebinding',
  ROLE_TEMPLATE:                 'management.cattle.io.roletemplate',
  SETTING:                       'management.cattle.io.setting',
  USER:                          'management.cattle.io.user',
  TOKEN:                         'management.cattle.io.token',
  GLOBAL_ROLE:                   'management.cattle.io.globalrole',
  GLOBAL_ROLE_BINDING:           'management.cattle.io.globalrolebinding',
  POD_SECURITY_POLICY_TEMPLATE:  'management.cattle.io.podsecuritypolicytemplate',
};

export const CAPI = {
  CAPI_CLUSTER:         'cluster.x-k8s.io.cluster',
  MACHINE_DEPLOYMENT:   'cluster.x-k8s.io.machinedeployment',
  MACHINE_SET:          'cluster.x-k8s.io.machineset',
  MACHINE:              'cluster.x-k8s.io.machine',
  RANCHER_CLUSTER:      'provisioning.cattle.io.cluster',
  MACHINE_CONFIG_GROUP: 'rke-machine-config.cattle.io',
};

// --------------------------------------
// 3. Optional add-on packages in a cluster
// --------------------------------------
// Base: /k8s/clusters/<id>/v1/

export const FLEET = {
  BUNDLE:        'fleet.cattle.io.bundle',
  CLUSTER:       'fleet.cattle.io.cluster',
  CLUSTER_GROUP: 'fleet.cattle.io.clustergroup',
  GIT_REPO:      'fleet.cattle.io.gitrepo',
  WORKSPACE:     'management.cattle.io.fleetworkspace',
  TOKEN:         'fleet.cattle.io.clusterregistrationtoken',
};

export const GATEKEEPER = {
  CONSTRAINT_TEMPLATE: 'templates.gatekeeper.sh.constrainttemplate',
  SPOOFED:             { CONSTRAINT: 'constraints.gatekeeper.sh.constraint' },
};

export const ISTIO = {
  VIRTUAL_SERVICE:  'networking.istio.io.virtualservice',
  DESTINATION_RULE: 'networking.istio.io.destinationrule',
  GATEWAY:          'networking.istio.io.gateway',
};

export const RIO = {
  CLUSTER_DOMAIN: 'admin.rio.cattle.io.clusterdomain',
  FEATURE:        'admin.rio.cattle.io.feature',
  INFO:           'admin.rio.cattle.io.rioinfo',
  PUBLIC_DOMAIN:  'admin.rio.cattle.io.publicdomain',

  APP:              'rio.cattle.io.app',
  EXTERNAL_SERVICE: 'rio.cattle.io.externalservice',
  STACK:            'rio.cattle.io.stack',
  ROUTER:           'rio.cattle.io.router',
  SERVICE:          'rio.cattle.io.service',

  SYSTEM_NAMESPACE: 'rio-system',
};

export const LOGGING = {
  // LOGGING:        'logging.banzaicloud.io.logging',
  CLUSTER_FLOW:   'logging.banzaicloud.io.clusterflow',
  CLUSTER_OUTPUT: 'logging.banzaicloud.io.clusteroutput',
  FLOW:           'logging.banzaicloud.io.flow',
  OUTPUT:         'logging.banzaicloud.io.output',
  SPOOFED:        {
    FILTERS:            'logging.banzaicloud.io.output.filters',
    FILTER:             'logging.banzaicloud.io.output.filter',
    CONCAT:             'logging.banzaicloud.io.output.filters.concat',
    DEDOT:              'logging.banzaicloud.io.output.filters.dedot',
    DETECTEXCEPTIONS:   'logging.banzaicloud.io.output.filters.detectExceptions',
    GEOIP:              'logging.banzaicloud.io.output.filters.geoip',
    GREP:               'logging.banzaicloud.io.output.filters.grep',
    PARSER:             'logging.banzaicloud.io.output.filters.parser',
    PROMETHEUS:         'logging.banzaicloud.io.output.filters.prometheus',
    RECORD_MODIFIER:    'logging.banzaicloud.io.output.filters.record_modifier',
    RECORD_TRANSFORMER: 'logging.banzaicloud.io.output.filters.record_transformer',
    STDOUT:             'logging.banzaicloud.io.output.filters.stdout',
    SUMOLOGIC:          'logging.banzaicloud.io.output.filters.sumologic',
    TAG_NORMALISER:     'logging.banzaicloud.io.output.filters.tag_normaliser',
    THROTTLE:           'logging.banzaicloud.io.output.filters.throttle',
    RECORD:             'logging.banzaicloud.io.output.filters.record',
    REGEXPSECTION:      'logging.banzaicloud.io.output.filters.regexpsection',
    EXCLUDESECTION:     'logging.banzaicloud.io.output.filters.excludesection',
    ORSECTION:          'logging.banzaicloud.io.output.filters.orsection',
    ANDSECTION:         'logging.banzaicloud.io.output.filters.andsection',
    PARSESECTION:       'logging.banzaicloud.io.output.filters.parsesection',
    METRICSECTION:      'logging.banzaicloud.io.output.filters.metricsection',
    REPLACE:            'logging.banzaicloud.io.output.filters.replace',
    SINGLEPARSESECTION: 'logging.banzaicloud.io.output.filters.replace.singleparsesection',
  },
};

export const BACKUP_RESTORE = {
  RESOURCE_SET: 'resources.cattle.io.resourceset',
  BACKUP:       'resources.cattle.io.backup',
  RESTORE:      'resources.cattle.io.restore',
};

export const CIS = {
  CLUSTER_SCAN:         'cis.cattle.io.clusterscan',
  CLUSTER_SCAN_PROFILE: 'cis.cattle.io.clusterscanprofile',
  BENCHMARK:            'cis.cattle.io.clusterscanbenchmark',
  REPORT:               'cis.cattle.io.clusterscanreport',
};

export const UI = { NAV_LINK: 'ui.cattle.io.navlink' };
