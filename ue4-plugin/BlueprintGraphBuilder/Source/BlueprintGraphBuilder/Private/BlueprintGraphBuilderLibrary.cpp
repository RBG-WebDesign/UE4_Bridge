#include "BlueprintGraphBuilderLibrary.h"

#include "EdGraph/EdGraph.h"
#include "EdGraphSchema_K2.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "K2Node_Event.h"
#include "K2Node_CallFunction.h"
#include "Kismet/KismetSystemLibrary.h"
#include "GameFramework/Actor.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

void UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON(
    UBlueprint* Blueprint,
    const FString& JsonString,
    bool bClearExistingGraph)
{
    if (!Blueprint)
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Blueprint is null"));
        return;
    }

    // --- Step 1: Parse JSON ---
    TSharedPtr<FJsonObject> RootObject;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);
    if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Invalid JSON: %s"), *JsonString);
        return;
    }

    // --- Step 2: Get event graph ---
    UEdGraph* Graph = FBlueprintEditorUtils::FindEventGraph(Blueprint);
    if (!Graph && Blueprint->UbergraphPages.Num() > 0)
    {
        Graph = Blueprint->UbergraphPages[0];
    }
    if (!Graph)
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: No event graph found on Blueprint"));
        return;
    }

    // --- Step 3: Clear existing nodes ---
    if (bClearExistingGraph)
    {
        TArray<UEdGraphNode*> NodesToRemove = Graph->Nodes;
        for (UEdGraphNode* Node : NodesToRemove)
        {
            FBlueprintEditorUtils::RemoveNode(Blueprint, Node, /*bDontRecompile=*/true);
        }
    }

    // --- Step 4: Spawn nodes ---
    const TArray<TSharedPtr<FJsonValue>>* NodesArray = nullptr;
    if (!RootObject->TryGetArrayField(TEXT("nodes"), NodesArray))
    {
        UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Missing 'nodes' array"));
        return;
    }

    TMap<FString, UEdGraphNode*> NodeMap;

    for (const TSharedPtr<FJsonValue>& NodeValue : *NodesArray)
    {
        const TSharedPtr<FJsonObject>* NodeObj = nullptr;
        if (!NodeValue->TryGetObject(NodeObj))
        {
            continue;
        }

        FString NodeId, NodeType;
        (*NodeObj)->TryGetStringField(TEXT("id"), NodeId);
        (*NodeObj)->TryGetStringField(TEXT("type"), NodeType);

        if (NodeId.IsEmpty() || NodeType.IsEmpty())
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Skipping node with missing id or type"));
            continue;
        }

        UEdGraphNode* SpawnedNode = nullptr;

        if (NodeType == TEXT("BeginPlay"))
        {
            FGraphNodeCreator<UK2Node_Event> Creator(*Graph);
            UK2Node_Event* EventNode = Creator.CreateNode();
            EventNode->EventReference.SetExternalMember(
                FName(TEXT("ReceiveBeginPlay")),
                AActor::StaticClass()
            );
            EventNode->bOverrideFunction = true;
            EventNode->NodePosX = 0;
            EventNode->NodePosY = 0;
            Creator.Finalize();
            SpawnedNode = EventNode;
        }
        else if (NodeType == TEXT("PrintString"))
        {
            UFunction* Func = UKismetSystemLibrary::StaticClass()->FindFunctionByName(TEXT("PrintString"));
            if (!Func)
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: PrintString function not found"));
                return;
            }
            FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
            UK2Node_CallFunction* CallNode = Creator.CreateNode();
            CallNode->SetFromFunction(Func);
            CallNode->NodePosX = 300;
            CallNode->NodePosY = 0;
            Creator.Finalize();
            SpawnedNode = CallNode;
        }
        else
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
            continue;
        }

        NodeMap.Add(NodeId, SpawnedNode);
    }

    // --- Step 5: Wire connections ---
    const TArray<TSharedPtr<FJsonValue>>* ConnectionsArray = nullptr;
    if (RootObject->TryGetArrayField(TEXT("connections"), ConnectionsArray))
    {
        for (const TSharedPtr<FJsonValue>& ConnValue : *ConnectionsArray)
        {
            const TSharedPtr<FJsonObject>* ConnObj = nullptr;
            if (!ConnValue->TryGetObject(ConnObj))
            {
                continue;
            }

            FString FromStr, ToStr;
            (*ConnObj)->TryGetStringField(TEXT("from"), FromStr);
            (*ConnObj)->TryGetStringField(TEXT("to"), ToStr);

            // Parse "nodeId.pinRole"
            FString FromNodeId, FromPinRole, ToNodeId, ToPinRole;
            FromStr.Split(TEXT("."), &FromNodeId, &FromPinRole);
            ToStr.Split(TEXT("."), &ToNodeId, &ToPinRole);

            UEdGraphNode** FromNodePtr = NodeMap.Find(FromNodeId);
            UEdGraphNode** ToNodePtr = NodeMap.Find(ToNodeId);
            if (!FromNodePtr || !ToNodePtr)
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Connection references unknown node(s): %s -> %s"), *FromStr, *ToStr);
                continue;
            }

            // For exec connections: source uses PN_Then (output), target uses PN_Execute (input)
            UEdGraphPin* SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
            UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);

            if (!SourcePin || !TargetPin)
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Could not find exec pins for connection %s -> %s"), *FromStr, *ToStr);
                continue;
            }

            SourcePin->MakeLinkTo(TargetPin);
        }
    }

    // --- Step 6: Mark and compile ---
    FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
    FKismetEditorUtilities::CompileBlueprint(Blueprint);
    Blueprint->MarkPackageDirty();

    UE_LOG(LogTemp, Log, TEXT("BuildBlueprintFromJSON: Done. %d nodes spawned."), NodeMap.Num());
}
