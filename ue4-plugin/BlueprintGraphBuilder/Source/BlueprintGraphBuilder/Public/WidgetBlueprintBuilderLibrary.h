#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "WidgetBlueprintBuilderLibrary.generated.h"

class UWidgetBlueprint;

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UWidgetBlueprintBuilderLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
	static bool BuildWidgetFromJSON(
		const FString& PackagePath,
		const FString& AssetName,
		const FString& JsonString,
		FString& OutError
	);

	UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
	static bool RebuildWidgetFromJSON(
		UWidgetBlueprint* WidgetBlueprint,
		const FString& JsonString,
		FString& OutError
	);

	UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
	static bool ValidateWidgetJSON(
		const FString& JsonString,
		FString& OutError
	);
};
