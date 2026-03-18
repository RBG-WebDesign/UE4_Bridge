#include "WidgetBlueprintBuilderLibrary.h"
#include "WidgetBuilder/WidgetBlueprintBuilder.h"
#include "WidgetBlueprint.h"

bool UWidgetBlueprintBuilderLibrary::BuildWidgetFromJSON(
	const FString& PackagePath,
	const FString& AssetName,
	const FString& JsonString,
	FString& OutError)
{
	UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] BuildWidgetFromJSON: path='%s', name='%s'"), *PackagePath, *AssetName);

	FWidgetBlueprintBuilder Builder;
	return Builder.Build(PackagePath, AssetName, JsonString, OutError);
}

bool UWidgetBlueprintBuilderLibrary::RebuildWidgetFromJSON(
	UWidgetBlueprint* WidgetBlueprint,
	const FString& JsonString,
	FString& OutError)
{
	UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] RebuildWidgetFromJSON"));

	FWidgetBlueprintBuilder Builder;
	return Builder.Rebuild(WidgetBlueprint, JsonString, OutError);
}

bool UWidgetBlueprintBuilderLibrary::ValidateWidgetJSON(
	const FString& JsonString,
	FString& OutError)
{
	FWidgetBlueprintBuilder Builder;
	return Builder.Validate(JsonString, OutError);
}
