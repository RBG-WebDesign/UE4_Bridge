#include "WidgetBlueprintValidator.h"
#include "WidgetClassRegistry.h"

bool FWidgetBlueprintValidator::Validate(
	const FWidgetBlueprintSpec& Spec,
	const FWidgetClassRegistry& Registry,
	FString& OutError)
{
	// Root must exist
	if (Spec.Root.Type.IsEmpty())
	{
		OutError = TEXT("[WidgetBuilder] Root widget has no type");
		return false;
	}

	// Root must be a panel type
	if (!Registry.IsSupportedType(Spec.Root.Type))
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] Root type '%s' is not supported. Supported: %s"),
			*Spec.Root.Type, *FString::Join(Registry.GetSupportedTypes(), TEXT(", ")));
		return false;
	}

	if (Registry.GetCategory(Spec.Root.Type) != EWidgetCategory::Panel)
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] Root widget must be a Panel type, got '%s'"), *Spec.Root.Type);
		return false;
	}

	TSet<FString> SeenNames;
	return ValidateNode(Spec.Root, Registry, SeenNames, TEXT(""), OutError);
}

bool FWidgetBlueprintValidator::ValidateNode(
	const FWidgetNodeSpec& Node,
	const FWidgetClassRegistry& Registry,
	TSet<FString>& SeenNames,
	const FString& Path,
	FString& OutError)
{
	FString NodePath = Path.IsEmpty() ? Node.Name : FString::Printf(TEXT("%s.%s"), *Path, *Node.Name);

	// Name must not be empty
	if (Node.Name.IsEmpty())
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Widget name is empty"), *NodePath);
		return false;
	}

	// Name must be unique
	if (SeenNames.Contains(Node.Name))
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Duplicate widget name '%s'"), *NodePath, *Node.Name);
		return false;
	}
	SeenNames.Add(Node.Name);

	// Type must be supported
	if (!Registry.IsSupportedType(Node.Type))
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported widget type '%s'"), *NodePath, *Node.Type);
		return false;
	}

	// Validate children based on category
	EWidgetCategory Category = Registry.GetCategory(Node.Type);
	switch (Category)
	{
	case EWidgetCategory::Leaf:
		if (Node.Children.Num() > 0)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Leaf widget '%s' cannot have children"), *NodePath, *Node.Type);
			return false;
		}
		break;
	case EWidgetCategory::Content:
		if (Node.Children.Num() > 1)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Content widget '%s' can have at most 1 child, got %d"),
				*NodePath, *Node.Type, Node.Children.Num());
			return false;
		}
		break;
	case EWidgetCategory::Panel:
		// 0..N children, no restriction
		break;
	}

	// Validate properties against registry
	const TArray<FWidgetPropertyDescriptor>* SupportedProps = Registry.GetSupportedProperties(Node.Type);
	if (SupportedProps)
	{
		for (const auto& Pair : Node.Properties)
		{
			bool bFound = false;
			for (const FWidgetPropertyDescriptor& Desc : *SupportedProps)
			{
				if (Desc.Name == Pair.Key)
				{
					bFound = true;
					// Check JSON type matches expected
					if (Pair.Value.IsValid() && Pair.Value->Type != Desc.ExpectedType)
					{
						OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Property '%s' has wrong type"), *NodePath, *Pair.Key);
						return false;
					}
					break;
				}
			}
			if (!bFound)
			{
				OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported property '%s' on %s"), *NodePath, *Pair.Key, *Node.Type);
				return false;
			}
		}
	}
	else if (Node.Properties.Num() > 0)
	{
		// No properties defined for this type but some were provided
		TArray<FString> Keys;
		Node.Properties.GetKeys(Keys);
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported property '%s' on %s"), *NodePath, *Keys[0], *Node.Type);
		return false;
	}

	// Recurse into children
	for (const FWidgetNodeSpec& Child : Node.Children)
	{
		if (!ValidateNode(Child, Registry, SeenNames, NodePath, OutError))
		{
			return false;
		}
	}

	return true;
}
