Pod::Spec.new do |s|
  s.name           = 'RakazoFoldRegions'
  s.version        = '0.1.0'
  s.summary        = 'Reports active window folding regions'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  sdk_version = `xcrun --sdk iphoneos --show-sdk-version`.strip
  compilation_conditions = '$(inherited)'
  if Gem::Version.new(sdk_version) >= Gem::Version.new('27.1')
    compilation_conditions += ' RAKAZO_HAS_RESERVED_REGIONS'
  end
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => compilation_conditions
  }
  s.source_files = '**/*.swift'
end
