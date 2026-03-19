#pragma once

#include "CoreMinimal.h"

class UAnimBlueprint;
class FAnimBPNodeRegistry;

class FAnimBPBuilder
{
public:
	FString Build(
		const FString& PackagePath,
		const FString& AssetName,
		const FString& SkeletonPath,
		const FString& JsonString
	);

	FString Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString);
	FString Validate(const FString& JsonString);

private:
	// Registry will be added when ABPNodeRegistry is created in Task 6
};
