#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "BlueprintGraphBuilderLibrary.generated.h"

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UBlueprintGraphBuilderLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /**
     * Builds a Blueprint event graph from a JSON description.
     *
     * JSON format:
     * {
     *   "nodes": [{"id": "start", "type": "BeginPlay"}, {"id": "print", "type": "PrintString"}],
     *   "connections": [{"from": "start.exec", "to": "print.exec"}]
     * }
     *
     * Supported types (Pass 1): BeginPlay, PrintString
     * Connection pin roles: exec (output Then on source, input Execute on target)
     */
    UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
    static void BuildBlueprintFromJSON(
        UBlueprint* Blueprint,
        const FString& JsonString,
        bool bClearExistingGraph = true
    );
};
