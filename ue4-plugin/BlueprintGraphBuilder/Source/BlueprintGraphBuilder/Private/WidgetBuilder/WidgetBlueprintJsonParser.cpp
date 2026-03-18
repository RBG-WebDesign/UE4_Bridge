#include "WidgetBlueprintJsonParser.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// Valid keys at node level
static const TSet<FString> ValidNodeKeys = { TEXT("type"), TEXT("name"), TEXT("properties"), TEXT("slot"), TEXT("children") };
// Valid keys in slot
static const TSet<FString> ValidSlotKeys = { TEXT("position"), TEXT("size"), TEXT("alignment"), TEXT("padding"), TEXT("zOrder"), TEXT("autoSize") };

bool FWidgetBlueprintJsonParser::Parse(const FString& JsonString, FWidgetBlueprintSpec& OutSpec, FString& OutError)
{
	TSharedPtr<FJsonObject> RootObj;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

	if (!FJsonSerializer::Deserialize(Reader, RootObj) || !RootObj.IsValid())
	{
		OutError = TEXT("[WidgetBuilder] Failed to parse JSON string");
		return false;
	}

	const TSharedPtr<FJsonObject>* RootNodeObj = nullptr;
	if (!RootObj->TryGetObjectField(TEXT("root"), RootNodeObj))
	{
		OutError = TEXT("[WidgetBuilder] Missing required 'root' object");
		return false;
	}

	return ParseWidgetNode(*RootNodeObj, OutSpec.Root, TEXT(""), OutError);
}

bool FWidgetBlueprintJsonParser::ParseWidgetNode(
	const TSharedPtr<FJsonObject>& NodeObj,
	FWidgetNodeSpec& OutNode,
	const FString& Path,
	FString& OutError)
{
	// Check for unknown keys at node level
	for (const auto& Pair : NodeObj->Values)
	{
		if (!ValidNodeKeys.Contains(Pair.Key))
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown key '%s' at node level"), *Path, *Pair.Key);
			return false;
		}
	}

	// Required: type
	if (!NodeObj->TryGetStringField(TEXT("type"), OutNode.Type))
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Missing required 'type' field"), *Path);
		return false;
	}

	// Required: name
	if (!NodeObj->TryGetStringField(TEXT("name"), OutNode.Name))
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Missing required 'name' field"), *Path);
		return false;
	}

	// Build path for this node
	FString NodePath = Path.IsEmpty() ? OutNode.Name : FString::Printf(TEXT("%s.%s"), *Path, *OutNode.Name);

	// Optional: properties
	const TSharedPtr<FJsonObject>* PropsObj = nullptr;
	if (NodeObj->TryGetObjectField(TEXT("properties"), PropsObj))
	{
		if (!ParseProperties(*PropsObj, OutNode.Properties, NodePath, OutError))
		{
			return false;
		}
	}

	// Optional: slot
	const TSharedPtr<FJsonObject>* SlotObj = nullptr;
	if (NodeObj->TryGetObjectField(TEXT("slot"), SlotObj))
	{
		OutNode.bHasSlot = true;
		if (!ParseSlotSpec(*SlotObj, OutNode.Slot, NodePath, OutError))
		{
			return false;
		}
	}

	// Optional: children
	const TArray<TSharedPtr<FJsonValue>>* ChildrenArray = nullptr;
	if (NodeObj->TryGetArrayField(TEXT("children"), ChildrenArray))
	{
		for (int32 i = 0; i < ChildrenArray->Num(); ++i)
		{
			const TSharedPtr<FJsonObject>& ChildObj = (*ChildrenArray)[i]->AsObject();
			if (!ChildObj.IsValid())
			{
				OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Child %d is not a valid object"), *NodePath, i);
				return false;
			}

			FWidgetNodeSpec ChildSpec;
			if (!ParseWidgetNode(ChildObj, ChildSpec, NodePath, OutError))
			{
				return false;
			}
			OutNode.Children.Add(MoveTemp(ChildSpec));
		}
	}

	return true;
}

bool FWidgetBlueprintJsonParser::ParseSlotSpec(
	const TSharedPtr<FJsonObject>& SlotObj,
	FWidgetSlotSpec& OutSlot,
	const FString& Path,
	FString& OutError)
{
	// Check for unknown keys
	for (const auto& Pair : SlotObj->Values)
	{
		if (!ValidSlotKeys.Contains(Pair.Key))
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: Unknown key '%s'"), *Path, *Pair.Key);
			return false;
		}
	}

	// position: {x, y}
	const TSharedPtr<FJsonObject>* PosObj = nullptr;
	if (SlotObj->TryGetObjectField(TEXT("position"), PosObj))
	{
		OutSlot.Position.X = (*PosObj)->GetNumberField(TEXT("x"));
		OutSlot.Position.Y = (*PosObj)->GetNumberField(TEXT("y"));
		OutSlot.bHasPosition = true;
	}

	// size: {x, y}
	const TSharedPtr<FJsonObject>* SizeObj = nullptr;
	if (SlotObj->TryGetObjectField(TEXT("size"), SizeObj))
	{
		OutSlot.Size.X = (*SizeObj)->GetNumberField(TEXT("x"));
		OutSlot.Size.Y = (*SizeObj)->GetNumberField(TEXT("y"));
		OutSlot.bHasSize = true;
	}

	// alignment: {x, y}
	const TSharedPtr<FJsonObject>* AlignObj = nullptr;
	if (SlotObj->TryGetObjectField(TEXT("alignment"), AlignObj))
	{
		OutSlot.Alignment.X = (*AlignObj)->GetNumberField(TEXT("x"));
		OutSlot.Alignment.Y = (*AlignObj)->GetNumberField(TEXT("y"));
		OutSlot.bHasAlignment = true;
	}

	// padding: {left, top, right, bottom}
	const TSharedPtr<FJsonObject>* PadObj = nullptr;
	if (SlotObj->TryGetObjectField(TEXT("padding"), PadObj))
	{
		OutSlot.Padding.Left = (*PadObj)->GetNumberField(TEXT("left"));
		OutSlot.Padding.Top = (*PadObj)->GetNumberField(TEXT("top"));
		OutSlot.Padding.Right = (*PadObj)->GetNumberField(TEXT("right"));
		OutSlot.Padding.Bottom = (*PadObj)->GetNumberField(TEXT("bottom"));
		OutSlot.bHasPadding = true;
	}

	// zOrder
	double ZOrder;
	if (SlotObj->TryGetNumberField(TEXT("zOrder"), ZOrder))
	{
		OutSlot.ZOrder = static_cast<int32>(ZOrder);
		OutSlot.bHasZOrder = true;
	}

	// autoSize
	bool AutoSize;
	if (SlotObj->TryGetBoolField(TEXT("autoSize"), AutoSize))
	{
		OutSlot.bAutoSize = AutoSize;
		OutSlot.bHasAutoSize = true;
	}

	return true;
}

bool FWidgetBlueprintJsonParser::ParseProperties(
	const TSharedPtr<FJsonObject>& PropsObj,
	TMap<FString, TSharedPtr<FJsonValue>>& OutProperties,
	const FString& Path,
	FString& OutError)
{
	// Accept all keys in properties -- validator decides which are supported
	for (const auto& Pair : PropsObj->Values)
	{
		OutProperties.Add(Pair.Key, Pair.Value);
	}
	return true;
}
