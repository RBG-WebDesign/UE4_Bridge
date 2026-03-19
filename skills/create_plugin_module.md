# Skill: create_plugin_module

Create a new UE4.27 C++ editor plugin from scratch.

## Required files

### 1. `PluginName.uplugin`
```json
{
  "FileVersion": 3,
  "Version": 1,
  "VersionName": "1.0",
  "FriendlyName": "My Plugin",
  "Description": "...",
  "Category": "Editor",
  "Installed": false,
  "Modules": [
    {
      "Name": "MyPlugin",
      "Type": "Editor",
      "LoadingPhase": "PostEngineInit"
    }
  ]
}
```
`Type` options: `Runtime`, `Editor`, `EditorNoCommandlet`
`LoadingPhase`: use `PostEngineInit` for editor tools that need the level editor ready.

### 2. `Source/MyPlugin/MyPlugin.Build.cs`
```csharp
using UnrealBuildTool;
public class MyPlugin : ModuleRules {
    public MyPlugin(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core" });
        PrivateDependencyModuleNames.AddRange(new string[] {
            "CoreUObject", "Engine", "Slate", "SlateCore",
            "LevelEditor", "EditorStyle", "InputCore", "UnrealEd",
            "WorkspaceMenuStructure", "HTTP", "Json", "JsonUtilities",
        });
    }
}
```

### 3. `Public/MyPluginModule.h`
```cpp
#pragma once
#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"
class FMyPluginModule : public IModuleInterface {
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;
};
```

### 4. `Private/MyPluginModule.cpp`
```cpp
#include "MyPluginModule.h"
#include "Widgets/Docking/SDockTab.h"
#include "Framework/Docking/TabManager.h"
#include "WorkspaceMenuStructure.h"
#include "WorkspaceMenuStructureModule.h"
#define LOCTEXT_NAMESPACE "FMyPluginModule"
static const FName TabName("MyPlugin");
void FMyPluginModule::StartupModule() {
    FGlobalTabmanager::Get()->RegisterNomadTabSpawner(TabName,
        FOnSpawnTab::CreateLambda([](const FSpawnTabArgs&) {
            return SNew(SDockTab).TabRole(ETabRole::NomadTab)
                [ SNew(STextBlock).Text(FText::FromString("Hello")) ];
        }))
        .SetDisplayName(LOCTEXT("TabTitle", "My Plugin"))
        .SetGroup(WorkspaceMenu::GetMenuStructure().GetDeveloperToolsMiscCategory());
}
void FMyPluginModule::ShutdownModule() {
    FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(TabName);
}
#undef LOCTEXT_NAMESPACE
IMPLEMENT_MODULE(FMyPluginModule, MyPlugin)
```

## Build command
```
D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat ProjectNameEditor Win64 Development
  -Project="D:/Path/To/Project.uproject" -WaitMutex
```

## Verify
After build, `Plugins/MyPlugin/Binaries/Win64/UE4Editor-MyPlugin.dll` must exist.
Open editor and check Window > Developer Tools for the tab spawner entry.
