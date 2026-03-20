#include "ABPBuilder.h"
#include "ABPBuildSpec.h"
#include "ABPNodeRegistry.h"

FString FAnimBPBuilder::Build(
	const FString& PackagePath,
	const FString& AssetName,
	const FString& SkeletonPath,
	const FString& JsonString)
{
	// TODO: Implement pipeline passes 1-8
	return TEXT("[AnimBPBuilder] not yet implemented");
}

FString FAnimBPBuilder::Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString)
{
	return TEXT("[AnimBPBuilder] Rebuild not yet implemented");
}

FString FAnimBPBuilder::Validate(const FString& JsonString)
{
	return TEXT("[AnimBPBuilder] Validate not yet implemented");
}
