#include "ABPBuilder.h"
#include "ABPBuildSpec.h"
#include "ABPNodeRegistry.h"
#include "ABPAssetFactory.h"
#include "ABPJsonParser.h"
#include "ABPValidator.h"

FString FAnimBPBuilder::Build(
	const FString& PackagePath,
	const FString& AssetName,
	const FString& SkeletonPath,
	const FString& JsonString)
{
	// Step 1: PARSE
	FAnimBPBuildSpec Spec;
	FString ParseError = FAnimBPJsonParser::Parse(JsonString, Spec);
	if (!ParseError.IsEmpty())
	{
		return ParseError;
	}

	// Step 2: VALIDATE
	TArray<FString> ValidationErrors = FAnimBPValidator::Validate(Spec);
	if (ValidationErrors.Num() > 0)
	{
		return FString::Join(ValidationErrors, TEXT("\n"));
	}

	// Step 3: CREATE ASSET
	FString Error;
	USkeleton* Skeleton = FAnimBPAssetFactory::ResolveSkeleton(SkeletonPath, Error);
	if (!Skeleton)
	{
		return Error;
	}

	UAnimBlueprint* AnimBP = FAnimBPAssetFactory::Create(PackagePath, AssetName, Skeleton, Error);
	if (!AnimBP)
	{
		return Error;
	}

	// Steps 4-6 will be added by later tasks

	return FString();
}

FString FAnimBPBuilder::Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString)
{
	return TEXT("[AnimBPBuilder] Rebuild not yet implemented");
}

FString FAnimBPBuilder::Validate(const FString& JsonString)
{
	// Parse JSON
	FAnimBPBuildSpec Spec;
	FString ParseError = FAnimBPJsonParser::Parse(JsonString, Spec);
	if (!ParseError.IsEmpty())
	{
		return ParseError;
	}

	// Validate spec
	TArray<FString> ValidationErrors = FAnimBPValidator::Validate(Spec);
	if (ValidationErrors.Num() > 0)
	{
		return FString::Join(ValidationErrors, TEXT("\n"));
	}

	return FString();
}
