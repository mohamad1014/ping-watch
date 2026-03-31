targetScope = 'resourceGroup'

@description('Short environment name used for tags and naming context.')
param environmentName string

@description('Azure region for all managed services.')
param location string = resourceGroup().location

@description('Resource name prefix used in tags and helper defaults.')
param projectName string = 'pingwatch'

@description('Globally unique Azure Database for PostgreSQL flexible server name.')
param postgresServerName string

@description('Administrator username for PostgreSQL.')
param postgresAdminLogin string = 'pingwatchadmin'

@secure()
@description('Administrator password for PostgreSQL.')
param postgresAdminPassword string

@description('Application database name to create.')
param postgresDatabaseName string = environmentName == 'production' ? 'pingwatch' : 'pingwatch_staging'

@description('PostgreSQL major version.')
@allowed([
  '14'
  '15'
  '16'
])
param postgresVersion string = '16'

@description('Lowest-cost practical PostgreSQL SKU for MVP workloads.')
param postgresSkuName string = 'Standard_B1ms'

@description('PostgreSQL compute tier.')
@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param postgresSkuTier string = 'Burstable'

@description('Allocated PostgreSQL storage in GB. 32 GB is the platform minimum and the lowest-cost starting point.')
param postgresStorageSizeGB int = 32

@description('Backup retention in days. 7 is the minimum and cheapest setting.')
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 7

@description('Whether PostgreSQL storage should auto-grow when space runs low.')
param postgresStorageAutoGrow bool = true

@description('Restrict PostgreSQL public access to the VPS IP when provided.')
param enablePostgresFirewallRule bool = true

@description('Start IP for the PostgreSQL firewall rule. Use the VPS public IP.')
param allowedClientIpStart string = ''

@description('End IP for the PostgreSQL firewall rule. Use the same VPS public IP for a single-host setup.')
param allowedClientIpEnd string = ''

@description('Globally unique storage account name (3-24 lowercase letters/numbers).')
param storageAccountName string

@description('Blob container name for clip uploads.')
param clipsContainerName string = environmentName == 'production' ? 'clips' : 'clips-staging'

@description('Storage replication choice. Standard_LRS is the lowest-cost durable option for MVP.')
@allowed([
  'Standard_LRS'
  'Standard_ZRS'
])
param storageSkuName string = 'Standard_LRS'

@description('Azure Managed Redis cluster name.')
param redisName string

@description('Deploy Azure Managed Redis. Keep this `false` for the cheapest MVP path and use Redis on the VPS instead.')
param deployRedis bool = false

@description('Lowest-cost practical Azure Managed Redis SKU for MVP workloads.')
param redisSkuName string = 'Balanced_B0'

@description('Disable Redis HA to minimize cost. This is acceptable only for MVP/dev-test style environments.')
param redisHighAvailability string = 'Disabled'

@description('Redis database TCP port.')
param redisDatabasePort int = 10000

@description('Resource tags applied to all managed resources.')
param tags object = {
  project: projectName
  environment: environmentName
  managedBy: 'bicep'
}

var postgresFirewallEnabled = enablePostgresFirewallRule && !empty(allowedClientIpStart) && !empty(allowedClientIpEnd)

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: storageSkuName
  }
  tags: tags
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storageAccount
  name: 'default'
}

resource clipsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: clipsContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  sku: {
    name: postgresSkuName
    tier: postgresSkuTier
  }
  tags: tags
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: postgresBackupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      autoGrow: postgresStorageAutoGrow ? 'Enabled' : 'Disabled'
      storageSizeGB: postgresStorageSizeGB
      type: 'Premium_LRS'
    }
    version: postgresVersion
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgresServer
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresFirewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (postgresFirewallEnabled) {
  parent: postgresServer
  name: 'allow-vps'
  properties: {
    startIpAddress: allowedClientIpStart
    endIpAddress: allowedClientIpEnd
  }
}

resource redisCluster 'Microsoft.Cache/redisEnterprise@2025-04-01' = if (deployRedis) {
  name: redisName
  location: location
  tags: tags
  properties: {
    encryption: {}
    highAvailability: redisHighAvailability
    minimumTlsVersion: '1.2'
  }
  sku: {
    name: redisSkuName
  }
}

resource redisDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' = if (deployRedis) {
  parent: redisCluster
  name: 'default'
  properties: {
    accessKeysAuthentication: 'Enabled'
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'OSSCluster'
    evictionPolicy: 'VolatileLRU'
    modules: []
    port: redisDatabasePort
  }
}

output storageAccountResourceId string = storageAccount.id
output storageAccountName string = storageAccount.name
output storageBlobEndpoint string = 'https://${storageAccount.name}.blob.${environment().suffixes.storage}'
output clipsContainerName string = clipsContainer.name
output postgresServerResourceId string = postgresServer.id
output postgresServerName string = postgresServer.name
output postgresServerFqdn string = '${postgresServer.name}.postgres.database.azure.com'
output postgresDatabaseName string = postgresDatabase.name
output postgresAdminLogin string = postgresAdminLogin
output postgresFirewallRuleName string = postgresFirewallEnabled ? postgresFirewallRule.name : ''
output redisClusterResourceId string = deployRedis ? redisCluster.id : ''
output redisClusterName string = deployRedis ? redisCluster.name : ''
output redisDatabasePort int = deployRedis ? redisDatabasePort : 0
output redisConnectionNotes string = deployRedis
  ? 'Fetch the host name and access keys from the Azure portal or CLI after deployment, then map them into REDIS_URL.'
  : 'Azure Managed Redis was skipped. For the cheapest MVP path, run Redis on the VPS and set REDIS_URL to the local instance.'
