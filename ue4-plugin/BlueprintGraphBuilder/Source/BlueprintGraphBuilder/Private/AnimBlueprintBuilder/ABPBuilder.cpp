#include "ABPBuilder.h"
#include "ABPBuildSpec.h"
#include "ABPNodeRegistry.h"
#include "ABPAssetFactory.h"
#include "ABPJsonParser.h"
#include "ABPValidator.h"
#include "ABPVariableBuilder.h"
#include "ABPAnimGraphBuilder.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Kismet2/BlueprintEditorUtils.h"

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

	// Step 4: VARIABLES
	{
		FString VarError = FAnimBPVariableBuilder::AddVariables(AnimBP, Spec.Variables);
		if (!VarError.IsEmpty()) return VarError;
	}

	// Compile after variables so they are available for later steps
	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(AnimBP);
	{
		FKismetCompilerOptions CompileOptions;
		FCompilerResultsLog Results;
		FKismetEditorUtilities::CompileBlueprint(AnimBP, CompileOptions, &Results);
		if (Results.NumErrors > 0)
		{
			return FString::Printf(TEXT("[AnimBPBuilder] compile after variables failed with %d error(s)"), Results.NumErrors);
		}
	}

	// Step 5: BUILD AnimGraph pipeline (StateMachine, Slot, Root wiring)
	FAnimBPBuildContext BuildCtx;
	BuildCtx.AnimBlueprint = AnimBP;
	BuildCtx.Skeleton = Skeleton;
	BuildCtx.Registry = &Registry;

	{
		FString BuildError = FAnimBPAnimGraphBuilder::Build(Spec, BuildCtx);
		if (!BuildError.IsEmpty()) return BuildError;
	}

	// Steps 6+ will be added by later tasks (state machine states, transitions, event graph)

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
