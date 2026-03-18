using UnrealBuildTool;

public class BlueprintGraphBuilder : ModuleRules
{
    public BlueprintGraphBuilder(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "UnrealEd",
            "BlueprintGraph",
            "KismetCompiler",
            "Kismet",
            "GraphEditor",
            "Json",
            "JsonUtilities",
            "UMG",
            "UMGEditor",
            "Slate",
            "SlateCore",
            "MovieScene",
            "MovieSceneTracks",
        });
    }
}
