require 'xcodeproj'
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = project.targets.find { |t| t.name == 'App' }
group = project.main_group.find_subpath('FamilyTrackWidgets', true)
group.set_source_tree('<group>')
group.set_path('FamilyTrackWidgets')
target = project.targets.find { |t| t.name == 'FamilyTrackWidgets' } || project.new_target(:app_extension, 'FamilyTrackWidgets', :ios, '17.0')
file = group.files.find { |f| f.path == 'FamilyTrackWidgets.swift' } || group.new_file('FamilyTrackWidgets.swift')
target.source_build_phase.add_file_reference(file, true)
app_group = project.main_group.find_subpath('App')
bridge = app_group.files.find { |f| f.path == 'WidgetBridge.swift' } || app_group.new_file('WidgetBridge.swift')
app.source_build_phase.add_file_reference(bridge, true)
app.add_dependency(target) unless app.dependencies.any? { |d| d.target == target }
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Widget Extension' } || app.new_copy_files_build_phase('Embed Widget Extension')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(target.product_reference, true)
target.build_configurations.each do |config|
  base = app.build_configurations.find { |c| c.name == config.name }.build_settings
  config.build_settings.merge!({
    'PRODUCT_NAME' => 'FamilyTrackWidgets',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'care.familytrack.app.widgets',
    'INFOPLIST_FILE' => 'FamilyTrackWidgets/Info.plist',
    'CODE_SIGN_ENTITLEMENTS' => 'FamilyTrackWidgets/Widgets.entitlements',
    'SWIFT_VERSION' => '5.0', 'TARGETED_DEVICE_FAMILY' => '1',
    'IPHONEOS_DEPLOYMENT_TARGET' => '17.0', 'SKIP_INSTALL' => 'YES',
    'APPLICATION_EXTENSION_API_ONLY' => 'YES',
    'MARKETING_VERSION' => base['MARKETING_VERSION'] || '1.0',
    'CURRENT_PROJECT_VERSION' => base['CURRENT_PROJECT_VERSION'] || '1',
    'DEVELOPMENT_TEAM' => '68ZTBX45Q7'
  })
end
project.save
puts 'Configured FamilyTrack widget extension and host bridge'
