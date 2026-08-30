const EXACT_SINGLE_VALUE_DIRECTIVES = Object.freeze({
  User: 'starstack',
  Group: 'starstack',
  NoNewPrivileges: 'true',
  PrivateDevices: 'true',
  PrivateTmp: 'true',
  ProtectHome: 'true',
  ProtectSystem: 'full',
  ReadOnlyPaths: '/opt/star-stack',
  ReadWritePaths: '/opt/star-stack/server/data',
  ProtectKernelTunables: 'false',
  ProtectKernelModules: 'false',
  ProtectKernelLogs: 'false',
  ProtectControlGroups: 'true',
  SystemCallFilter: '~@module syslog',
  RestrictRealtime: 'true',
  RestrictSUIDSGID: 'true',
  LockPersonality: 'true',
  CapabilityBoundingSet: '',
  AmbientCapabilities: '',
  UMask: '0077',
  MemoryMax: '768M',
  TasksMax: '256',
})

const directiveValues = (source, name) => source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.startsWith(`${name}=`))
  .map((line) => line.slice(name.length + 1))

export const assertJudgeSystemdUnit = (source) => {
  if (typeof source !== 'string' || !source.trim()) throw new Error('StarStack API systemd unit is empty')
  for (const [name, expected] of Object.entries(EXACT_SINGLE_VALUE_DIRECTIVES)) {
    const values = directiveValues(source, name)
    if (values.length !== 1 || values[0] !== expected) {
      throw new Error(`${name}= must appear exactly once with the production judge value ${JSON.stringify(expected)}`)
    }
  }
  return true
}

export const assertJudgeKernelPrerequisites = ({ dmesgRestrict }) => {
  if (String(dmesgRestrict).trim() !== '1') {
    throw new Error('kernel.dmesg_restrict must be 1 before disabling systemd ProtectKernelLogs for the judge service')
  }
  return true
}
